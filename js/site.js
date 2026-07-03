/* ============================================================
   Nirmit Shah — interactive bits
   1. Data-viz dot grid that reacts to the cursor
   2. Soft cursor glow
   3. Magnetic link pills
   ============================================================ */

(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- footer year ----
    var yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    /* ---------------- cursor glow ---------------- */
    var glow = document.querySelector('.cursor-glow');
    var mouse = { x: -9999, y: -9999, active: false };

    window.addEventListener('pointermove', function (e) {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        if (!mouse.active) {
            mouse.active = true;
            if (glow) glow.style.opacity = '1';
        }
        if (glow) {
            glow.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
        }
    }, { passive: true });

    window.addEventListener('pointerleave', function () {
        mouse.active = false;
        mouse.x = mouse.y = -9999;
        if (glow) glow.style.opacity = '0';
    });

    /* ---------------- magnetic pills ---------------- */
    if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
        document.querySelectorAll('.pill').forEach(function (pill) {
            pill.addEventListener('pointermove', function (e) {
                var r = pill.getBoundingClientRect();
                var dx = (e.clientX - (r.left + r.width / 2)) * 0.25;
                var dy = (e.clientY - (r.top + r.height / 2)) * 0.35;
                pill.style.transform = 'translate(' + dx + 'px,' + (dy - 3) + 'px)';
            });
            pill.addEventListener('pointerleave', function () {
                pill.style.transform = '';
            });
        });
    }

    /* ---------------- company popovers ---------------- */
    (function () {
        var badges = document.querySelectorAll('.co[data-team]');
        if (!badges.length) return;

        var pop = document.createElement('div');
        pop.className = 'copop';
        pop.setAttribute('role', 'tooltip');
        document.body.appendChild(pop);

        var pinned = null; // badge kept open by click/tap

        function esc(s) {
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        function place(badge) {
            var teams = (badge.getAttribute('data-team') || '').split(';');
            var years = (badge.getAttribute('data-years') || '').split(';');
            var html = '';
            for (var i = 0; i < teams.length; i++) {
                var t = teams[i].trim();
                var y = (years[i] || '').trim();
                if (!t && !y) continue;
                html += '<div class="pop-role">' +
                    '<div class="pop-team">' + esc(t) + '</div>' +
                    '<div class="pop-years">' + esc(y) + '</div></div>';
            }
            pop.innerHTML = html;
            var accent = getComputedStyle(badge).getPropertyValue('--cc').trim() || '#36f9a7';
            pop.style.setProperty('--pc', accent);

            var r = badge.getBoundingClientRect();
            var cx = r.left + r.width / 2;
            var margin = 12;
            // measure width to keep it on screen
            pop.classList.add('show');
            var half = pop.offsetWidth / 2;
            cx = Math.max(half + margin, Math.min(window.innerWidth - half - margin, cx));
            pop.style.left = cx + 'px';
            pop.style.top = r.top + 'px';
        }

        function show(badge) { place(badge); }
        function hide() {
            if (pinned) return;
            pop.classList.remove('show');
        }
        function forceHide() {
            pinned = null;
            pop.classList.remove('show');
        }

        badges.forEach(function (badge) {
            badge.addEventListener('mouseenter', function () { if (!pinned) show(badge); });
            badge.addEventListener('mouseleave', hide);
            badge.addEventListener('focus', function () { show(badge); });
            badge.addEventListener('blur', forceHide);
            badge.addEventListener('click', function (e) {
                e.stopPropagation();
                if (pinned === badge) { forceHide(); }
                else { pinned = badge; show(badge); }
            });
            badge.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (pinned === badge) forceHide();
                    else { pinned = badge; show(badge); }
                }
            });
        });

        document.addEventListener('click', forceHide);
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') forceHide(); });
        window.addEventListener('scroll', forceHide, { passive: true });
        window.addEventListener('resize', forceHide);
    })();

    /* ---------------- dot grid canvas ---------------- */
    var canvas = document.getElementById('grid-bg');
    if (!canvas || reduceMotion) return;

    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0;
    var dots = [];
    var GAP = 42;          // spacing between dots
    var RADIUS = 150;      // cursor influence radius

    // theme accents cycled across the grid for a subtle data-viz shimmer
    var palette = [
        [54, 249, 167],   // mint
        [158, 54, 249],   // purple
        [54, 197, 249]    // cyan
    ];

    function build() {
        W = canvas.width = Math.floor(window.innerWidth * dpr);
        H = canvas.height = Math.floor(window.innerHeight * dpr);
        canvas.style.width = window.innerWidth + 'px';
        canvas.style.height = window.innerHeight + 'px';

        dots = [];
        var g = GAP * dpr;
        var cols = Math.ceil(window.innerWidth / GAP) + 1;
        var rows = Math.ceil(window.innerHeight / GAP) + 1;
        for (var iy = 0; iy < rows; iy++) {
            for (var ix = 0; ix < cols; ix++) {
                dots.push({
                    ox: ix * g,
                    oy: iy * g,
                    x: ix * g,
                    y: iy * g,
                    c: palette[(ix + iy) % palette.length]
                });
            }
        }
    }

    var mx = -9999, my = -9999;
    window.addEventListener('pointermove', function (e) {
        mx = e.clientX * dpr;
        my = e.clientY * dpr;
    }, { passive: true });
    window.addEventListener('pointerleave', function () { mx = my = -9999; });

    var influence = RADIUS * dpr;
    var t = 0;

    function frame() {
        ctx.clearRect(0, 0, W, H);
        t += 0.006;

        for (var i = 0; i < dots.length; i++) {
            var d = dots[i];

            // gentle ambient drift
            var driftX = Math.sin(t + d.oy * 0.01) * 2 * dpr;
            var driftY = Math.cos(t + d.ox * 0.01) * 2 * dpr;
            var baseX = d.ox + driftX;
            var baseY = d.oy + driftY;

            var dx = baseX - mx;
            var dy = baseY - my;
            var dist = Math.sqrt(dx * dx + dy * dy);

            var size = 1.1 * dpr;
            var alpha = 0.18;

            if (dist < influence) {
                var force = (1 - dist / influence);
                // push dots outward from cursor
                var ang = Math.atan2(dy, dx);
                var push = force * 16 * dpr;
                baseX += Math.cos(ang) * push;
                baseY += Math.sin(ang) * push;
                size += force * force * 3.2 * dpr;
                alpha = 0.18 + force * 0.72;
            }

            // ease toward target for smoothness
            d.x += (baseX - d.x) * 0.18;
            d.y += (baseY - d.y) * 0.18;

            ctx.beginPath();
            ctx.arc(d.x, d.y, size, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(' + d.c[0] + ',' + d.c[1] + ',' + d.c[2] + ',' + alpha + ')';
            ctx.fill();
        }

        requestAnimationFrame(frame);
    }

    var resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            influence = RADIUS * dpr;
            build();
        }, 150);
    });

    build();
    requestAnimationFrame(frame);
})();
