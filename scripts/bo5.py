#!/usr/bin/env python3
"""Build game-by-game best-of-five histories for League of Legends pro players from Leaguepedia.

    python3 scripts/bo5.py Faker Chovy --out bo5/players
    python3 scripts/bo5.py --min 20 --index bo5/players.json   # everyone with 20+ best-of-fives
    python3 scripts/bo5.py --best-of 3 --min 100 --index bo3/players.json   # best-of-threes instead

Everything below says best-of-five; with --best-of 3 read best-of-three, 2 for 3, and
scripts/bo3_fixes.json for scripts/bo5_fixes.json.

Writes one JSON file per player. Standard library only, so it can run in a GitHub Action.

The tables every player shares (schedules, scoreboard games, per-game winners, tournament levels)
are downloaded whole, once, up front; each player then needs only their own scoreboard and roster
rows, fetched for 50 players at a time. That keeps a run of a thousand players to a few hundred
requests instead of twenty per player.

A series is a scheduled best-of-five (MatchSchedule.BestOf = 5) that one of the player's teams
played and finished (someone reached 3, no forfeit). Its game order comes from, in turn:
  1. Leaguepedia's scoreboards for that match ID;
  2. scoreboards filed under a different match ID: same event, same two teams, close in time;
  3. MatchScheduleGame's per-game winners;
  4. the final score alone, when it was 3-0 or 0-3.
A series counts when the player played at least one of its games. When no game in the series has
a scoreboard, there is no way to tell, so it counts if the player was on that team's roster for
the event, and is flagged "r". Series where the player played only some games are flagged "p".
Events Leaguepedia files as showmatches are left out (pass --showmatches to keep them), except
All-Star events, which it also files that way but which were played for real.
Series whose game order can't be found are listed under "unknown" rather than guessed, unless
scripts/bo5_fixes.json supplies it from another source.
"""

import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

EXPORT = 'https://lol.fandom.com/wiki/Special:CargoExport'
UA = 'Mozilla/5.0 (compatible; bo5-history/1.0; +https://nirmit.dev/faker-bo5/)'
PAGE_SIZE = 5000
FIXES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bo{}_fixes.json')
NUMERIC = {'N', 'S1', 'S2', 'BestOf', 'Winner', 'FF', 'Null'}  # every other field is text
BEST_OF, TO_WIN = 5, 3  # set by --best-of


def set_best_of(n):
    global BEST_OF, TO_WIN, STATES
    BEST_OF, TO_WIN = n, n // 2 + 1
    # Scorelines a series can pass through without being over, for the leaderboard: 0-0, 1-0, 0-1, 2-0, ...
    STATES = [f'{w}-{k - w}' for k in range(n) for w in range(k, -1, -1) if w < TO_WIN and k - w < TO_WIN]


def cargo(tables, fields, where, join_on=None, order_by=None, group_by=None, having=None):
    """Run one Cargo query through Special:CargoExport, paging until every row is in.
    Anything that can run past one page needs an order_by, or the pages can overlap."""
    rows, offset = [], 0
    while True:
        params = {'tables': tables, 'fields': fields, 'where': where, 'limit': PAGE_SIZE,
                  'offset': offset, 'format': 'json'}
        for k, v in (('join_on', join_on), ('order_by', order_by), ('group_by', group_by), ('having', having)):
            if v:
                params[k] = v
        url = EXPORT + '?' + urllib.parse.urlencode(params)
        for attempt in range(5):
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                    page = json.load(r)
                break
            except Exception as e:  # rate limits and timeouts: back off and retry
                if attempt == 4:
                    raise
                print(f'  retrying after {e}', file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        time.sleep(1)  # be polite to the wiki
        # The export turns number-like text into numbers (a team called "100", a player called "909").
        rows += [{k: str(v) if v is not None and k not in NUMERIC else v for k, v in r.items()} for r in page]
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def q(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


def in_list(field, values, chunk=25):
    """Split a long IN (...) into chunks so the request URL stays a sane length."""
    values = sorted(values)
    for i in range(0, len(values), chunk):
        yield f'{field} IN ({",".join(q(v) for v in values[i:i + chunk])})'


def key(name):
    """A player name as the wiki's database compares it: case and accents don't count."""
    return ''.join(c for c in unicodedata.normalize('NFKD', name) if not unicodedata.combining(c)).casefold()


def when(s):
    return datetime.strptime(s, '%Y-%m-%d %H:%M:%S') if s else None


# ---------- labels ----------

ROUNDS = {'Finals': 'Final', 'Semifinals': 'Semifinal', 'Quarterfinals': 'Quarterfinal'}
INTL = ('IEM', 'Asian Games', 'Esports World Cup', 'All-Star', 'Rift Rivals', 'First Stand',
        'Esports Championships', 'Intel Extreme', 'World Cyber Games', 'Mid-Season Cup')


def event_name(page):
    m = re.match(r'(?:Season (\d)|(\d{4}) Season) World Championship', page)
    if m:
        return 'Worlds ' + (m.group(2) or str(2010 + int(m.group(1))))
    m = re.match(r'(\d{4}) Mid-Season Invitational', page)
    if m:
        return 'MSI ' + m.group(1)
    m = re.match(r'([^/]+)/(\d{4}) Season/(.+)', page)
    if m:
        league, year, rest = m.groups()
        rest = rest.replace(' Season', '').replace('Season Playoffs', 'Playoffs')
        return f'{league} {year} {rest}'
    m = re.match(r'(\d{4}) (.+)', page)  # "2018 Asian Games" -> "Asian Games 2018"
    if m and '/' not in page:
        return f'{m.group(2)} {m.group(1)}'
    return page.replace('/', ' ')


def kind(page):
    if re.match(r'(Season \d|\d{4} Season) World Championship', page):
        return 'worlds'
    if 'Mid-Season Invitational' in page:
        return 'msi'
    if any(k in page for k in INTL):
        return 'intl'
    return 'dom'


def round_name(match_id, page, tab):
    r = match_id[len(page) + 1:].rsplit('_', 1)[0] if match_id.startswith(page + '_') else (tab or '')
    r = ROUNDS.get(r, r)
    return '' if r.startswith(('Week', 'Day')) else r


def short_team(t):
    return t.replace(' (National Team)', '')


# ---------- data every player shares ----------

class Shared:
    """Whole tables, downloaded once and indexed for the per-player lookups in build()."""

    def __init__(self):
        print('fetching schedules', file=sys.stderr)
        self.best_of = {}  # MatchId -> BestOf, for every scheduled match
        self.sched = defaultdict(list)  # OverviewPage -> its best-of-five matches
        for s in cargo('MatchSchedule=MS',
                       'MS.MatchId=MatchId,MS.OverviewPage=Page,MS.Team1=T1,MS.Team2=T2,MS.Team1Score=S1,'
                       'MS.Team2Score=S2,MS.DateTime_UTC=DT,MS.FF=FF,MS.IsNullified=Null,MS.Tab=Tab,MS.BestOf=BestOf',
                       '1=1', order_by='MS._ID'):
            self.best_of[s['MatchId']] = s['BestOf']
            if s['BestOf'] == BEST_OF:
                self.sched[s['Page']].append(s)

        print('fetching scoreboard games', file=sys.stderr)
        self.games = {}  # GameId -> game
        self.games_by_page = defaultdict(list)
        for g in cargo('ScoreboardGames=SG',
                       'SG.GameId=GameId,SG.MatchId=MatchId,SG.N_GameInMatch=N,SG.OverviewPage=Page,'
                       'SG.DateTime_UTC=DT,SG.Team1=T1,SG.Team2=T2,SG.WinTeam=Win', '1=1', order_by='SG._ID'):
            self.games[g['GameId']] = g
            self.games_by_page[g['Page']].append(g)

        print('fetching per-game winners', file=sys.stderr)
        self.per_game = defaultdict(list)
        for g in cargo('MatchScheduleGame=MSG,MatchSchedule=MS', 'MSG.MatchId=MatchId,MSG.N_GameInMatch=N,'
                       'MSG.Blue=Blue,MSG.Red=Red,MSG.Winner=Winner', f'MS.BestOf={BEST_OF}',
                       join_on='MSG.MatchId=MS.MatchId', order_by='MSG._ID'):
            self.per_game[g['MatchId']].append(g)

        print('fetching tournaments', file=sys.stderr)
        self.level = {}  # tournament level per event: Primary, Secondary or Showmatch
        for t in cargo('Tournaments=T', 'T.OverviewPage=Page,T.TournamentLevel=Level', '1=1', order_by='T._ID'):
            self.level[t['Page']] = {'Primary': 'P', 'Secondary': 'S', 'Showmatch': 'X'}.get(t['Level'], '')

        fixes = FIXES.format(BEST_OF)
        self.fixes = json.load(open(fixes)) if os.path.exists(fixes) else {}

    def players(self, names):
        """Each player's scoreboard games, joined to the shared tables, and roster rows, keyed by key(name)."""
        played, roster = defaultdict(list), defaultdict(list)
        none = dict.fromkeys(['MatchId', 'N', 'Page', 'DT', 'T1', 'T2', 'Win'])
        for clause in in_list('SP.Link', names, chunk=50):
            for r in cargo('ScoreboardPlayers=SP', 'SP.Link=Link,SP.GameId=GameId,SP.Team=Team', clause,
                           order_by='SP._ID'):
                g = self.games.get(r['GameId'], none)
                played[key(r['Link'])].append({**g, 'GameId': r['GameId'], 'Team': r['Team'],
                                               'BestOf': self.best_of.get(g['MatchId'])})
        for clause in in_list('TP.Link', names, chunk=50):
            for r in cargo('TournamentPlayers=TP', 'TP.Link=Link,TP.OverviewPage=Page,TP.Team=Team', clause,
                           order_by='TP._ID'):
                roster[key(r['Link'])].append(r)
        return played, roster


def discover(n):
    """Everyone who could have n or more best-of-fives: n with scoreboards, or n on a roster that played them.
    The real count comes from build(); this only has to not miss anyone."""
    print(f'finding players with {n}+ best-of-{BEST_OF}s', file=sys.stderr)
    # One year at a time: counted over every year at once, the best-of-three joins time out on the wiki.
    on_roster, played = defaultdict(int), defaultdict(int)
    for y in range(2011, datetime.now(timezone.utc).year + 1):
        year = f'MS.BestOf={BEST_OF} AND MS.DateTime_UTC >= "{y}-01-01" AND MS.DateTime_UTC < "{y + 1}-01-01"'
        for r in cargo('TournamentPlayers=TP,MatchSchedule=MS', 'TP.Link=Link,COUNT(DISTINCT MS.MatchId)=Count',
                       year + ' AND (MS.Team1=TP.Team OR MS.Team2=TP.Team)',
                       join_on='TP.OverviewPage=MS.OverviewPage', group_by='TP.Link', order_by='TP.Link'):
            on_roster[r['Link']] += int(r['Count'])
        for r in cargo('ScoreboardPlayers=SP,ScoreboardGames=SG,MatchSchedule=MS',
                       'SP.Link=Link,COUNT(DISTINCT SG.MatchId)=Count', year,
                       join_on='SP.GameId=SG.GameId,SG.MatchId=MS.MatchId', group_by='SP.Link', order_by='SP.Link'):
            played[r['Link']] += int(r['Count'])
    # The tables spell some names differently ("meiko", "Meiko"); prefer the scoreboard spelling.
    return {key(p): p for counts in (on_roster, played) for p, c in counts.items() if p and c >= n}


# ---------- one player ----------

def build(player, played, roster, shared, showmatches=False):
    played_ids = {g['GameId'] for g in played}
    # Which team(s) the player was on at each event, from scoreboards and from rosters.
    teams = defaultdict(set)
    for r in played + roster:
        if r['Page'] and r['Team']:
            teams[r['Page']].add(r['Team'])
    on_roster = {(r['Page'], r['Team']) for r in roster}

    sched = [s for page in sorted(teams) for s in shared.sched.get(page, [])
             if s['T1'] in teams[page] or s['T2'] in teams[page]]

    # Every scoreboard game those teams played at those events, whoever was on the field.
    all_teams = set().union(*teams.values())
    team_games = [g for page in sorted({s['Page'] for s in sched}) for g in shared.games_by_page.get(page, [])
                  if g['T1'] in all_teams or g['T2'] in all_teams]
    by_match = defaultdict(list)
    for g in team_games:
        by_match[g['MatchId']].append(g)

    per_game, level = shared.per_game, shared.level

    def skipped(page):
        return not showmatches and level.get(page) == 'X' and 'All-Star' not in page

    used = set()  # scoreboard games already assigned to a series

    def games_for(s, team, opp, n, window):
        """Scoreboard games for a scheduled series: by match ID, else the closest whole match of n games
        between the same two teams at the same event, filed under another match ID."""
        gs = [g for g in by_match.get(s['MatchId'], []) if team in (g['T1'], g['T2'])]
        if not gs and s['DT']:
            t = when(s['DT'])
            near = defaultdict(list)
            for g in team_games:
                if (g['Page'] == s['Page'] and {g['T1'], g['T2']} == {team, opp} and g['GameId'] not in used
                        and g['DT'] and abs(when(g['DT']) - t) < window):
                    near[g['MatchId']].append(g)
            fits = [m for m in near.values() if len(m) == n]
            gs = min(fits, key=lambda m: min(abs(when(g['DT']) - t) for g in m), default=[])
        return sorted(gs, key=lambda g: (g['N'] or 0, g['DT'] or ''))

    series, unknown, sat_out = [], [], 0
    pending = []
    for s in sched:
        if s['FF'] or s['Null'] in (True, 'Yes', 1, '1'):
            continue
        team = s['T1'] if s['T1'] in teams[s['Page']] else s['T2']
        opp = s['T2'] if team == s['T1'] else s['T1']
        mine, theirs = (s['S1'], s['S2']) if team == s['T1'] else (s['S2'], s['S1'])
        if mine is None or theirs is None or max(mine, theirs) != TO_WIN:
            continue  # unfinished, a draw, or not really a Bo5 (e.g. Rift Rivals relay games)
        if skipped(s['Page']):
            continue
        gs = games_for(s, team, opp, mine + theirs, timedelta(hours=20))
        pending.append((s, team, opp, mine, theirs, gs))

    # Second pass: series still without games may have them filed a day or two off.
    for s, team, opp, mine, theirs, gs in pending:
        used.update(g['GameId'] for g in gs)
    for i, (s, team, opp, mine, theirs, gs) in enumerate(pending):
        if not gs:
            gs = games_for(s, team, opp, mine + theirs, timedelta(days=3))
            if gs:
                used.update(g['GameId'] for g in gs)
                pending[i] = (s, team, opp, mine, theirs, gs)

    for s, team, opp, mine, theirs, gs in pending:
        seq, flag = None, ''
        if gs:
            if not any(g['GameId'] in played_ids for g in gs):
                sat_out += 1
                continue
            if not all(g['GameId'] in played_ids for g in gs):
                flag = 'p'
            seq = ''.join('W' if g['Win'] == team else 'L' for g in gs)
        else:
            if (s['Page'], team) not in on_roster:
                continue
            flag = 'r'
            pg = sorted(per_game.get(s['MatchId'], []), key=lambda g: g['N'] or 0)
            if pg and all(g['Winner'] in (1, 2, '1', '2') for g in pg):
                seq = ''.join('W' if (g['Blue'] if int(g['Winner']) == 1 else g['Red']) == team else 'L' for g in pg)
            elif min(mine, theirs) == 0:
                seq = 'W' * TO_WIN if mine == TO_WIN else 'L' * TO_WIN
        row = [s['DT'][:10] if s['DT'] else '', event_name(s['Page']), round_name(s['MatchId'], s['Page'], s['Tab']),
               short_team(team), short_team(opp)]
        if not (seq and seq.count('W') == mine and seq.count('L') == theirs and complete(seq)) and min(mine, theirs) == 0:
            seq = 'W' * TO_WIN if mine == TO_WIN else 'L' * TO_WIN  # game records incomplete, but a sweep has only one order
        if seq and seq.count('W') == mine and seq.count('L') == theirs and complete(seq):
            series.append(row + [seq, flag, kind(s['Page']), level.get(s['Page'], '')])
        else:
            unknown.append(row + [f'{mine}-{theirs}', seq or '', kind(s['Page']), level.get(s['Page'], '')])

    # Bo5s missing from the schedule entirely: the player's own games under a match ID with no
    # series length. Four or more games, or three games all won by one side, can only be a Bo5;
    # three games split 2-1 can only be a Bo3 (two won by one side could as well be a Bo2).
    loose = defaultdict(list)
    for g in played:
        if g['GameId'] not in used and g['BestOf'] in (None, ''):
            loose[g['MatchId']].append(g)
    for mid, gs in loose.items():
        if skipped(gs[0]['Page']):
            continue
        gs.sort(key=lambda g: (g['N'] or 0, g['DT'] or ''))
        team = gs[0]['Team']
        team_gs = sorted([g for g in by_match.get(mid, []) if team in (g['T1'], g['T2'])] or gs,
                         key=lambda g: (g['N'] or 0, g['DT'] or ''))
        seq = ''.join('W' if g['Win'] == team else 'L' for g in team_gs)
        if not complete(seq) or len(seq) < 3:
            continue
        g0 = team_gs[0]
        opp = g0['T2'] if g0['T1'] == team else g0['T1']
        flag = '' if all(g['GameId'] in played_ids for g in team_gs) else 'p'
        series.append([g0['DT'][:10] if g0['DT'] else '', event_name(g0['Page']), round_name(mid, g0['Page'], ''),
                       short_team(team), short_team(opp), seq, flag, kind(g0['Page']), level.get(g0['Page'], '')])

    # Game orders found elsewhere (press reports) for series Leaguepedia has no game records for.
    for fx in shared.fixes.get(player, []):
        for u in unknown:
            mine, theirs = map(int, u[5].split('-'))
            if (u[0], u[4]) == (fx['date'], fx['opponent']) and complete(fx['games']) \
                    and (fx['games'].count('W'), fx['games'].count('L')) == (mine, theirs):
                series.append(u[:5] + [fx['games'], '', u[7], u[8]])
                unknown.remove(u)
                break

    series.sort()
    unknown.sort()
    print(f'{player}: {len(series)} series, {len(unknown)} with unknown order, sat out {sat_out}', file=sys.stderr)
    return {
        'player': player,
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
        # flag: '' played, 'p' played part, 'r' roster only (no game records).
        # level: tournament level, 'P' primary, 'S' secondary, 'X' showmatch, '' unknown.
        'fields': ['date', 'event', 'round', 'team', 'opponent', 'games', 'flag', 'kind', 'level'],
        'series': series,
        'unknown': unknown,  # date, event, round, team, opponent, final score, partial games, kind, level
    }


set_best_of(5)


def from_states(series):
    """[series that reached the scoreline, series won from there] for each of STATES."""
    tally = {k: [0, 0] for k in STATES}
    for x in series:
        seq, won = x[5], x[5].count('W') == TO_WIN
        for k in range(len(seq)):  # the score before game k+1 was played
            t = tally[f"{seq[:k].count('W')}-{seq[:k].count('L')}"]
            t[0] += 1
            t[1] += won
    return [tally[k] for k in STATES]


def write_index(out, path, n):
    """One row per player for the page's search box and leaderboard, most best-of-fives first."""
    rows = []
    for f in sorted(os.listdir(out)):
        if not f.endswith('.json'):
            continue
        d = json.load(open(os.path.join(out, f)))
        S = d['series']
        if not S:
            continue
        rows.append([d['player'], re.sub(r' \(.*\)$', '', d['player']), len(S),
                     sum(1 for x in S if x[5].count('W') == TO_WIN), S[-1][3], S[0][0][:4], S[-1][0][:4], from_states(S)])
    rows.sort(key=lambda r: (-r[2], r[1].lower()))
    index = {'generated': datetime.now(timezone.utc).strftime('%Y-%m-%d'), 'bestOf': BEST_OF, 'min': n,
             'fields': ['page', 'name', 'series', 'won', 'team', 'from', 'to', 'states'], 'states': STATES,
             'players': rows}
    if same_but_date(path, index):
        print(f'index: {len(rows)} players, unchanged', file=sys.stderr)
        return
    dump(index, path)
    print(f'index: {len(rows)} players -> {path}', file=sys.stderr)


def dump(data, path):
    """Write data as JSON with one key per line and one row per line, so a diff shows which series or players changed."""
    def compact(v):
        return json.dumps(v, ensure_ascii=False, separators=(',', ':'))
    lines = []
    for k, v in data.items():
        if isinstance(v, list) and v and all(isinstance(x, list) for x in v):
            rows = ',\n'.join('    ' + compact(x) for x in v)
            lines.append(f'  {compact(k)}: [\n{rows}\n  ]')
        else:
            lines.append(f'  {compact(k)}: {compact(v)}')
    with open(path, 'w') as fh:
        fh.write('{\n' + ',\n'.join(lines) + '\n}\n')


def same_but_date(path, data):
    """True if the JSON file at path already holds data, apart from its 'generated' date."""
    try:
        old = json.load(open(path))
    except (OSError, ValueError):
        return False
    return 'generated' in old and {**old, 'generated': None} == {**data, 'generated': None}


def complete(seq):
    """True if seq is a complete series: someone reaches TO_WIN on the last game and not before."""
    w = l = 0
    for i, c in enumerate(seq):
        w, l = w + (c == 'W'), l + (c == 'L')
        if (w == TO_WIN or l == TO_WIN) and i != len(seq) - 1:
            return False
    return w == TO_WIN or l == TO_WIN


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('players', nargs='*', help='Leaguepedia page names, e.g. Faker or "Zeka (Kim Geon-woo)"')
    ap.add_argument('--best-of', type=int, choices=(3, 5), default=5, help='series length (default 5)')
    ap.add_argument('--out', help='directory for the per-player JSON files (default bo5/players or bo3/players)')
    ap.add_argument('--showmatches', action='store_true', help='keep events Leaguepedia files as showmatches')
    ap.add_argument('--index', metavar='PATH', help='also write a search index of every player file in --out')
    ap.add_argument('--min', type=int, metavar='N',
                    help='also find and write every player with at least N best-of-fives')
    a = ap.parse_args()
    set_best_of(a.best_of)
    a.out = a.out or f'bo{a.best_of}/players'
    os.makedirs(a.out, exist_ok=True)
    start = time.time()
    found = discover(a.min) if a.min else {}
    # Group-by picks a spelling per run ("Hans sama", "Hans Sama"); keep the one already on disk so URLs hold.
    found.update({k: f[:-5] for f in os.listdir(a.out) if f.endswith('.json') and (k := key(f[:-5])) in found})
    named = {key(p) for p in a.players}
    players = list(a.players) + sorted(p for k, p in found.items() if k not in named)
    shared = Shared() if players else None
    failed, written = [], 0
    batch = 50
    for i in range(0, len(players), batch):
        names = players[i:i + batch]
        print(f'players {i + 1}-{i + len(names)} of {len(players)} ({time.time() - start:.0f}s)', file=sys.stderr)
        played, roster = shared.players(names)
        for p in names:
            try:
                data = build(p, played[key(p)], roster[key(p)], shared, a.showmatches)
            except Exception as e:  # one bad player shouldn't sink a long run
                print(f'{p}: FAILED {e!r}', file=sys.stderr)
                failed.append(p)
                continue
            if key(p) not in named and len(data['series']) < a.min:
                continue  # discovery overcounts; only keep who really reached --min
            path = os.path.join(a.out, p.replace('/', '_') + '.json')
            if same_but_date(path, data):
                continue  # leave the file alone so a scheduled run only commits real changes
            dump(data, path)
            written += 1
    print(f'{len(players)} players checked, {written} changed, in {time.time() - start:.0f}s', file=sys.stderr)
    if a.index:
        write_index(a.out, a.index, a.min)
    if failed:
        print('failed: ' + ', '.join(failed), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
