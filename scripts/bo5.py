#!/usr/bin/env python3
"""Build game-by-game best-of-five histories for League of Legends pro players from Leaguepedia.

    python3 scripts/bo5.py Faker Chovy --out bo5/players

Writes one JSON file per player. Standard library only, so it can run in a GitHub Action.

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
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

EXPORT = 'https://lol.fandom.com/wiki/Special:CargoExport'
UA = 'Mozilla/5.0 (compatible; bo5-history/1.0; +https://nirmit.dev/faker-bo5/)'
PAGE_SIZE = 5000
FIXES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bo5_fixes.json')
NUMERIC = {'N', 'S1', 'S2', 'BestOf', 'Winner', 'FF', 'Null'}  # every other field is text


def cargo(tables, fields, where, join_on=None, order_by=None):
    """Run one Cargo query through Special:CargoExport, paging until every row is in."""
    rows, offset = [], 0
    while True:
        params = {'tables': tables, 'fields': fields, 'where': where, 'limit': PAGE_SIZE,
                  'offset': offset, 'format': 'json'}
        if join_on:
            params['join_on'] = join_on
        if order_by:
            params['order_by'] = order_by
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


# ---------- one player ----------

def build(player, showmatches=False):
    print(f'{player}: fetching', file=sys.stderr)
    w = f'SP.Link={q(player)}'
    played = cargo('ScoreboardPlayers=SP,ScoreboardGames=SG,MatchSchedule=MS',
                   'SP.GameId=GameId,SP.Team=Team,SG.MatchId=MatchId,SG.N_GameInMatch=N,SG.OverviewPage=Page,'
                   'SG.DateTime_UTC=DT,SG.Team1=T1,SG.Team2=T2,SG.WinTeam=Win,MS.BestOf=BestOf',
                   w, join_on='SP.GameId=SG.GameId,SG.MatchId=MS.MatchId')
    roster = cargo('TournamentPlayers=TP', 'TP.OverviewPage=Page,TP.Team=Team', f'TP.Link={q(player)}')

    played_ids = {g['GameId'] for g in played}
    # Which team(s) the player was on at each event, from scoreboards and from rosters.
    teams = defaultdict(set)
    for r in played + roster:
        if r['Page'] and r['Team']:
            teams[r['Page']].add(r['Team'])
    on_roster = {(r['Page'], r['Team']) for r in roster}

    sched = []
    for clause in in_list('MS.OverviewPage', teams):
        sched += cargo('MatchSchedule=MS',
                       'MS.MatchId=MatchId,MS.OverviewPage=Page,MS.Team1=T1,MS.Team2=T2,MS.Team1Score=S1,'
                       'MS.Team2Score=S2,MS.DateTime_UTC=DT,MS.FF=FF,MS.IsNullified=Null,MS.Tab=Tab',
                       f'MS.BestOf=5 AND {clause}')
    sched = [s for s in sched if s['T1'] in teams[s['Page']] or s['T2'] in teams[s['Page']]]

    # Every scoreboard game those teams played at those events, whoever was on the field.
    all_teams = sorted(set().union(*teams.values())) if teams else []
    on_team = f'(SG.Team1 IN ({",".join(map(q, all_teams))}) OR SG.Team2 IN ({",".join(map(q, all_teams))}))'
    team_games = []
    for clause in in_list('SG.OverviewPage', {s['Page'] for s in sched}):
        team_games += cargo('ScoreboardGames=SG',
                            'SG.GameId=GameId,SG.MatchId=MatchId,SG.N_GameInMatch=N,SG.OverviewPage=Page,'
                            'SG.DateTime_UTC=DT,SG.Team1=T1,SG.Team2=T2,SG.WinTeam=Win', f'{clause} AND {on_team}')
    by_match = defaultdict(list)
    for g in team_games:
        by_match[g['MatchId']].append(g)

    per_game = defaultdict(list)
    for clause in in_list('MSG.MatchId', {s['MatchId'] for s in sched}):
        for g in cargo('MatchScheduleGame=MSG', 'MSG.MatchId=MatchId,MSG.N_GameInMatch=N,MSG.Blue=Blue,'
                       'MSG.Red=Red,MSG.Winner=Winner', clause):
            per_game[g['MatchId']].append(g)

    level = {}  # tournament level per event: Primary, Secondary or Showmatch
    for clause in in_list('T.OverviewPage', {s['Page'] for s in sched} | {g['Page'] for g in played}):
        for t in cargo('Tournaments=T', 'T.OverviewPage=Page,T.TournamentLevel=Level', clause):
            level[t['Page']] = {'Primary': 'P', 'Secondary': 'S', 'Showmatch': 'X'}.get(t['Level'], '')

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
        if mine is None or theirs is None or max(mine, theirs) != 3:
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
                seq = 'W' * 3 if mine == 3 else 'L' * 3
        row = [s['DT'][:10] if s['DT'] else '', event_name(s['Page']), round_name(s['MatchId'], s['Page'], s['Tab']),
               short_team(team), short_team(opp)]
        if not (seq and seq.count('W') == mine and seq.count('L') == theirs and is_bo5(seq)) and min(mine, theirs) == 0:
            seq = 'W' * 3 if mine == 3 else 'L' * 3  # game records incomplete, but a sweep has only one order
        if seq and seq.count('W') == mine and seq.count('L') == theirs and is_bo5(seq):
            series.append(row + [seq, flag, kind(s['Page']), level.get(s['Page'], '')])
        else:
            unknown.append(row + [f'{mine}-{theirs}', seq or '', kind(s['Page']), level.get(s['Page'], '')])

    # Bo5s missing from the schedule entirely: the player's own games under a match ID with no
    # series length. Four or more games, or three games all won by one side, can only be a Bo5.
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
        if not is_bo5(seq) or (len(seq) == 3 and len(set(seq)) != 1) or len(seq) < 3:
            continue
        g0 = team_gs[0]
        opp = g0['T2'] if g0['T1'] == team else g0['T1']
        flag = '' if all(g['GameId'] in played_ids for g in team_gs) else 'p'
        series.append([g0['DT'][:10] if g0['DT'] else '', event_name(g0['Page']), round_name(mid, g0['Page'], ''),
                       short_team(team), short_team(opp), seq, flag, kind(g0['Page']), level.get(g0['Page'], '')])

    # Game orders found elsewhere (press reports) for series Leaguepedia has no game records for.
    fixes = json.load(open(FIXES)).get(player, []) if os.path.exists(FIXES) else []
    for fx in fixes:
        for u in unknown:
            mine, theirs = map(int, u[5].split('-'))
            if (u[0], u[4]) == (fx['date'], fx['opponent']) and is_bo5(fx['games']) \
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


# Scorelines a series can pass through without being over, for the leaderboard.
STATES = ['0-0', '1-0', '0-1', '2-0', '1-1', '0-2', '2-1', '1-2', '2-2']


def from_states(series):
    """[series that reached the scoreline, series won from there] for each of STATES."""
    tally = {k: [0, 0] for k in STATES}
    for x in series:
        seq, won = x[5], x[5].count('W') == 3
        for k in range(len(seq)):  # the score before game k+1 was played
            t = tally[f"{seq[:k].count('W')}-{seq[:k].count('L')}"]
            t[0] += 1
            t[1] += won
    return [tally[k] for k in STATES]


def write_index(out, path):
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
                     sum(1 for x in S if x[5].count('W') == 3), S[-1][3], S[0][0][:4], S[-1][0][:4], from_states(S)])
    rows.sort(key=lambda r: (-r[2], r[1].lower()))
    with open(path, 'w') as fh:
        json.dump({'fields': ['page', 'name', 'series', 'won', 'team', 'from', 'to', 'states'], 'states': STATES,
                   'players': rows},
                  fh, ensure_ascii=False, separators=(',', ':'))
    print(f'index: {len(rows)} players -> {path}', file=sys.stderr)


def is_bo5(seq):
    """True if seq is a complete best-of-five: someone reaches 3 on the last game and not before."""
    w = l = 0
    for i, c in enumerate(seq):
        w, l = w + (c == 'W'), l + (c == 'L')
        if (w == 3 or l == 3) and i != len(seq) - 1:
            return False
    return w == 3 or l == 3


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('players', nargs='*', help='Leaguepedia page names, e.g. Faker or "Zeka (Kim Geon-woo)"')
    ap.add_argument('--out', default='bo5/players', help='directory for the per-player JSON files')
    ap.add_argument('--showmatches', action='store_true', help='keep events Leaguepedia files as showmatches')
    ap.add_argument('--index', metavar='PATH', help='also write a search index of every player file in --out')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    failed = []
    for p in a.players:
        try:
            data = build(p, a.showmatches)
        except Exception as e:  # one bad player shouldn't sink a long run
            print(f'{p}: FAILED {e}', file=sys.stderr)
            failed.append(p)
            continue
        with open(os.path.join(a.out, p.replace('/', '_') + '.json'), 'w') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    if a.index:
        write_index(a.out, a.index)
    if failed:
        print('failed: ' + ', '.join(failed), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
