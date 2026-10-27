// 뉴스 게임: 발행된 호의 개념 해설(questions[].concepts)과 영어 기사 제목으로 게임 문제를 자동으로 만든다.
// app.js 의 '추가 활동' 탭에서 NewsGames.mount(요소, 호 JSON, 호 이름) 으로 띄운다. 점수는 이 화면에만 남는다.
(function () {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const shuffle = (xs) => {
    const a = xs.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // ---- 한글 도우미 ----
  const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  const isHangul = (ch) => ch >= "가" && ch <= "힣";
  const chosung = (s) => [...s].map((ch) => (isHangul(ch) ? CHO[Math.floor((ch.charCodeAt(0) - 0xac00) / 588)] : ch)).join("");
  const mainPart = (term) => term.replace(/\s*\([^)]*\)/g, "").trim(); // "자유주의(롤스)" → "자유주의"
  const norm = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[\s·.,\-–()']/g, "");
  const hangulOnly = (term) => mainPart(term).replace(/[^가-힣]/g, "");
  // 정의에 용어 자체가 들어 있으면 가린다
  const maskTerm = (desc, term) => {
    let out = desc;
    for (const t of new Set([term, mainPart(term)])) if (t.length > 1) out = out.split(t).join("○○");
    return out;
  };

  // ---- 문제 재료 모으기 ----
  function conceptsOf(issue) {
    const seen = new Set();
    const out = [];
    const add = (c, from) => {
      if (!c || !c.term || !c.desc || seen.has(c.term)) return;
      seen.add(c.term);
      out.push({ term: c.term, desc: maskTerm(c.desc, c.term), from });
    };
    for (const a of issue.articles || []) for (const q of a.questions || []) (q.concepts || []).forEach((c) => add(c, a.title));
    if (issue.compare) (issue.compare.concepts || []).forEach((c) => add(c, issue.compare.title));
    return out;
  }

  function englishHeadlinesOf(issue) {
    const seen = new Set();
    const out = [];
    const add = (title, url, source, ko) => {
      if (!title || seen.has(title)) return;
      seen.add(title);
      out.push({ title, url, source, ko });
    };
    for (const a of issue.articles || []) for (const l of a.links || []) if (l.lang === "en") add(l.label || l.title, l.url, l.source, a.title);
    for (const h of issue.headlines || []) if (h.lang === "en") add(h.label || h.title, h.url, h.source, "");
    if (issue.compare) for (const it of issue.compare.items || []) if (it.lang === "en") add(it.title, it.url, it.source, issue.compare.title);
    return out;
  }

  const STOP = new Set("about after again against also among another because been before being between both could does doing down during each from further have having here into itself just more most much must only other over same should some such than that their them then there these they this those through under until very were what when where which while will with would your says said".split(" "));
  const blankable = (w) => /^[a-z]{4,}$/.test(w) && !STOP.has(w);
  const wordsOf = (title) => title.split(/\s+/).map((w) => w.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ""));

  // ---- 1. 개념 초성 퀴즈 ----
  function chosungGame(root, concepts) {
    const ROUNDS = Math.min(10, concepts.length);
    let list, i, score, log, hinted;
    const start = () => { list = shuffle(concepts).slice(0, ROUNDS); i = 0; score = 0; log = []; show(); };
    function show() {
      if (i >= list.length) return finish();
      const c = list[i];
      hinted = false;
      const target = mainPart(c.term);
      root.innerHTML = `
        <div class="g-progress">${i + 1} / ${list.length}<span class="g-score">맞힌 개수 ${score}</span></div>
        <p class="g-desc">${esc(c.desc)}</p>
        <p class="g-chosung" aria-label="초성 힌트">${esc(chosung(target))}</p>
        <p class="g-from muted">나온 기사: ${esc(c.from)}</p>
        <form class="g-answer" autocomplete="off">
          <input name="a" aria-label="정답 입력" placeholder="정답을 한글로 입력" required>
          <button class="primary">확인</button>
        </form>
        <div class="g-row">
          <button type="button" class="link-btn" data-g="hint">첫 글자 보기</button>
          <button type="button" class="link-btn" data-g="skip">모르겠어요</button>
        </div>
        <p class="g-feedback" role="status"></p>`;
      const form = root.querySelector("form");
      form.a.focus({ preventScroll: true });
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        if (norm(form.a.value) === norm(c.term) || norm(form.a.value) === norm(target)) result(true);
        else { root.querySelector(".g-feedback").textContent = "아니에요. 초성과 설명을 다시 살펴보세요."; form.a.select(); }
      });
      root.querySelector('[data-g="hint"]').onclick = () => {
        hinted = true;
        root.querySelector(".g-chosung").textContent = target[0] + chosung(target.slice(1));
      };
      root.querySelector('[data-g="skip"]').onclick = () => result(false);
    }
    function result(ok) {
      const c = list[i];
      if (ok) score++;
      log.push({ c, ok, hinted });
      root.querySelector(".g-answer").remove();
      root.querySelector(".g-row").remove();
      const fb = root.querySelector(".g-feedback");
      fb.className = "g-feedback " + (ok ? "ok" : "no");
      fb.innerHTML = `${ok ? "정답이에요!" : "정답:"} <b>${esc(c.term)}</b>`;
      fb.insertAdjacentHTML("afterend", `<button type="button" class="primary g-next">${i + 1 < list.length ? "다음 문제" : "결과 보기"}</button>`);
      const next = root.querySelector(".g-next");
      next.focus({ preventScroll: true });
      next.onclick = () => { i++; show(); };
    }
    function finish() {
      root.innerHTML = `
        <p class="g-final">${list.length}문제 중 <b>${score}</b>개를 맞혔어요.</p>
        <ul class="g-review">${log.map(({ c, ok }) => `<li class="${ok ? "ok" : "no"}"><b>${esc(c.term)}</b> <span class="muted">${esc(c.desc)}</span></li>`).join("")}</ul>
        <button type="button" class="primary g-again">다시 하기</button>`;
      root.querySelector(".g-again").onclick = start;
    }
    start();
  }

  // ---- 2. 영어 헤드라인 빈칸 ----
  function englishGame(root, heads) {
    const items = heads.map((h) => ({ ...h, cands: [...new Set(wordsOf(h.title).filter(blankable))] })).filter((h) => h.cands.length);
    const pool = [...new Set(items.flatMap((h) => h.cands))];
    let list, i, score;
    const start = () => {
      list = shuffle(items).slice(0, 8).map((h) => {
        const answer = shuffle(h.cands).sort((a, b) => b.length - a.length)[0]; // 긴 낱말일수록 내용어일 가능성이 크다
        const wrong = shuffle(pool.filter((w) => !h.cands.includes(w))).slice(0, 3);
        return { ...h, answer, choices: shuffle([answer, ...wrong]) };
      });
      i = 0; score = 0; show();
    };
    function blanked(h) {
      return esc(h.title).replace(new RegExp(`\\b${h.answer}\\b`), '<span class="g-blank">_____</span>');
    }
    function show() {
      if (i >= list.length) {
        root.innerHTML = `<p class="g-final">${list.length}문제 중 <b>${score}</b>개를 맞혔어요.</p>
          <ul class="g-review">${list.map((h) => `<li><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="muted">${esc(h.source)}</span></li>`).join("")}</ul>
          <button type="button" class="primary g-again">다시 하기</button>`;
        root.querySelector(".g-again").onclick = start;
        return;
      }
      const h = list[i];
      root.innerHTML = `
        <div class="g-progress">${i + 1} / ${list.length}<span class="g-score">맞힌 개수 ${score}</span></div>
        <p class="g-headline" lang="en">${blanked(h)}</p>
        <p class="g-from muted">${esc(h.source)}${h.ko ? ` · 관련 기사: ${esc(h.ko)}` : ""}</p>
        <div class="g-choices">${h.choices.map((w) => `<button type="button" lang="en" data-w="${esc(w)}">${esc(w)}</button>`).join("")}</div>
        <p class="g-feedback" role="status"></p>`;
      root.querySelector(".g-choices").onclick = (e) => {
        const b = e.target.closest("button[data-w]");
        if (!b) return;
        const ok = b.dataset.w === h.answer;
        if (ok) score++;
        root.querySelectorAll(".g-choices button").forEach((x) => {
          x.disabled = true;
          if (x.dataset.w === h.answer) x.classList.add("ok");
          else if (x === b) x.classList.add("no");
        });
        root.querySelector(".g-blank").outerHTML = `<b class="g-filled">${esc(h.answer)}</b>`;
        const fb = root.querySelector(".g-feedback");
        fb.className = "g-feedback " + (ok ? "ok" : "no");
        fb.innerHTML = `${ok ? "정답이에요!" : `정답: <b lang="en">${esc(h.answer)}</b>`} <a href="${esc(h.url)}" target="_blank" rel="noopener">원문 보기 ↗</a>`;
        fb.insertAdjacentHTML("afterend", `<button type="button" class="primary g-next">${i + 1 < list.length ? "다음 문제" : "결과 보기"}</button>`);
        root.querySelector(".g-next").onclick = () => { i++; show(); };
      };
    }
    start();
  }

  // ---- 3. 십자말풀이 ----
  // 음절 단위 격자에 낱말을 가로·세로로 엇갈려 놓는다. 여러 번 시도해 가장 많이 놓인 판을 고른다.
  const box = (ps) => {
    const r0 = Math.min(...ps.map((p) => p.r)), c0 = Math.min(...ps.map((p) => p.c));
    const r1 = Math.max(...ps.map((p) => p.r + (p.dir === "down" ? p.w.length : 1)));
    const c1 = Math.max(...ps.map((p) => p.c + (p.dir === "across" ? p.w.length : 1)));
    return { rows: r1 - r0, cols: c1 - c0 };
  };

  function buildCrossword(words, target = 9, tries = 60, maxSide = 10) {
    let best = null, bestArea = Infinity;
    for (let t = 0; t < tries; t++) {
      const order = shuffle(words).sort((a, b) => b.w.length - a.w.length + (Math.random() - 0.5) * 3);
      const grid = new Map();
      const key = (r, c) => r + "," + c;
      const placed = [];
      const fits = (w, r, c, dir) => {
        const dr = dir === "down" ? 1 : 0, dc = dir === "down" ? 0 : 1;
        if (grid.has(key(r - dr, c - dc)) || grid.has(key(r + dr * w.length, c + dc * w.length))) return -1;
        let cross = 0;
        for (let k = 0; k < w.length; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          const cell = grid.get(key(rr, cc));
          if (cell) {
            if (cell.ch !== w[k] || cell[dir]) return -1;
            cross++;
          } else if (grid.has(key(rr + dc, cc + dr)) || grid.has(key(rr - dc, cc - dr))) return -1;
        }
        return cross;
      };
      const put = (item, r, c, dir) => {
        const dr = dir === "down" ? 1 : 0, dc = dir === "down" ? 0 : 1;
        for (let k = 0; k < item.w.length; k++) {
          const kk = key(r + dr * k, c + dc * k);
          const cell = grid.get(kk) || { ch: item.w[k] };
          cell[dir] = true;
          grid.set(kk, cell);
        }
        placed.push({ ...item, r, c, dir });
      };
      put(order[0], 0, 0, "across");
      for (const item of order.slice(1)) {
        if (placed.length >= target) break;
        const options = [];
        for (const p of placed) {
          const dir = p.dir === "across" ? "down" : "across";
          for (let a = 0; a < p.w.length; a++) for (let b = 0; b < item.w.length; b++) {
            if (p.w[a] !== item.w[b]) continue;
            const pr = p.r + (p.dir === "down" ? a : 0), pc = p.c + (p.dir === "across" ? a : 0);
            const r = pr - (dir === "down" ? b : 0), c = pc - (dir === "across" ? b : 0);
            const cross = fits(item.w, r, c, dir);
            if (cross > 0) {
              const b = box(placed.concat({ r, c, dir, w: item.w }));
              if (b.rows <= maxSide && b.cols <= maxSide) options.push({ r, c, dir, cross, area: b.rows * b.cols });
            }
          }
        }
        if (options.length) {
          options.sort((x, y) => y.cross - x.cross || x.area - y.area);
          put(item, options[0].r, options[0].c, options[0].dir);
        }
      }
      const area = box(placed).rows * box(placed).cols;
      if (!best || placed.length > best.length || (placed.length === best.length && area < bestArea)) { best = placed; bestArea = area; }
    }
    if (!best || best.length < 3) return null;
    const minR = Math.min(...best.map((p) => p.r)), minC = Math.min(...best.map((p) => p.c));
    best.forEach((p) => { p.r -= minR; p.c -= minC; });
    const rows = Math.max(...best.map((p) => p.r + (p.dir === "down" ? p.w.length : 1)));
    const cols = Math.max(...best.map((p) => p.c + (p.dir === "across" ? p.w.length : 1)));
    // 번호: 위→아래, 왼→오 순서로 시작 칸에 매긴다
    const starts = [...new Set(best.map((p) => p.r * 1000 + p.c))].sort((a, b) => a - b);
    best.forEach((p) => { p.no = starts.indexOf(p.r * 1000 + p.c) + 1; });
    best.sort((a, b) => a.no - b.no);
    return { words: best, rows, cols };
  }

  function crosswordGame(root, concepts) {
    const words = concepts.map((c) => ({ ...c, w: hangulOnly(c.term) })).filter((c) => c.w.length >= 2 && c.w.length <= 7);
    let puzzle, solved, current;
    const cellsOf = (p) => [...p.w].map((_, k) => [p.r + (p.dir === "down" ? k : 0), p.c + (p.dir === "across" ? k : 0)]);
    function start() {
      puzzle = buildCrossword(words);
      if (!puzzle) { root.innerHTML = `<p class="muted">이번 호에는 십자말풀이를 만들 만큼 겹치는 낱말이 없어요.</p>`; return; }
      solved = new Set();
      current = puzzle.words[0];
      draw();
    }
    function draw() {
      const { rows, cols } = puzzle;
      const letters = new Map(), numbers = new Map(), active = new Set(cellsOf(current).map(([r, c]) => r + "," + c));
      puzzle.words.forEach((p) => {
        numbers.set(p.r + "," + p.c, p.no);
        cellsOf(p).forEach(([r, c], k) => {
          const kk = r + "," + c;
          if (!letters.has(kk)) letters.set(kk, "");
          if (solved.has(p)) letters.set(kk, p.w[k]);
        });
      });
      let cells = "";
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const kk = r + "," + c;
        if (!letters.has(kk)) { cells += `<div class="cw-empty"></div>`; continue; }
        cells += `<div class="cw-cell${active.has(kk) ? " on" : ""}" data-rc="${kk}">${numbers.has(kk) ? `<small>${numbers.get(kk)}</small>` : ""}${esc(letters.get(kk))}</div>`;
      }
      const clue = (p) => `<li class="${p === current ? "on" : ""}${solved.has(p) ? " done" : ""}"><button type="button" data-no="${p.no}" data-dir="${p.dir}"><b>${p.no}</b> ${solved.has(p) ? `<strong class="cw-ans">${esc(p.term)}</strong> ` : ""}${esc(p.desc)}${solved.has(p) ? "" : ` <span class="muted">(${p.w.length}글자)</span>`}</button></li>`;
      const across = puzzle.words.filter((p) => p.dir === "across"), down = puzzle.words.filter((p) => p.dir === "down");
      const done = solved.size === puzzle.words.length;
      root.innerHTML = `
        <div class="cw">
          <div class="cw-board" style="--cols:${cols}" aria-hidden="true">${cells}</div>
          <div class="cw-side">
            ${done ? `<p class="g-final">다 풀었어요! 낱말 ${puzzle.words.length}개를 모두 맞혔어요.</p><button type="button" class="primary g-again">새 판 만들기</button>` : `
            <div class="cw-current"><b>${current.no}번 ${current.dir === "across" ? "가로" : "세로"}</b> ${esc(current.desc)}</div>
            <form class="g-answer" autocomplete="off">
              <input name="a" aria-label="${current.no}번 ${current.dir === "across" ? "가로" : "세로"} 정답" placeholder="${current.w.length}글자" required>
              <button class="primary">확인</button>
            </form>
            <div class="g-row"><button type="button" class="link-btn" data-g="hint">초성 보기</button><button type="button" class="link-btn" data-g="show">답 보기</button></div>
            <p class="g-feedback" role="status"></p>`}
            <div class="cw-clues">
              <h4>가로</h4><ol>${across.map(clue).join("")}</ol>
              <h4>세로</h4><ol>${down.map(clue).join("")}</ol>
            </div>
            <p class="muted g-small">맞힌 낱말 ${solved.size} / ${puzzle.words.length} · 겹치는 칸의 글자가 힌트가 돼요.</p>
          </div>
        </div>`;
      if (done) { root.querySelector(".g-again").onclick = start; }
      else {
        const form = root.querySelector("form");
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          if (norm(form.a.value) === norm(current.w) || norm(form.a.value) === norm(current.term)) solve(current);
          else { root.querySelector(".g-feedback").textContent = "아니에요. 다시 생각해 보세요."; form.a.select(); }
        });
        root.querySelector('[data-g="hint"]').onclick = () => { root.querySelector(".g-feedback").textContent = "초성: " + chosung(current.w); };
        root.querySelector('[data-g="show"]').onclick = () => solve(current, true);
      }
      root.querySelector(".cw-clues").onclick = (e) => {
        const b = e.target.closest("button[data-no]");
        if (!b) return;
        current = puzzle.words.find((p) => String(p.no) === b.dataset.no && p.dir === b.dataset.dir);
        draw();
        const inp = root.querySelector(".g-answer input");
        if (inp) inp.focus({ preventScroll: true });
      };
      root.querySelector(".cw-board").onclick = (e) => {
        const cell = e.target.closest("[data-rc]");
        if (!cell) return;
        const hits = puzzle.words.filter((p) => cellsOf(p).some(([r, c]) => r + "," + c === cell.dataset.rc));
        current = hits.find((p) => p !== current && !solved.has(p)) || hits.find((p) => !solved.has(p)) || hits[0];
        draw();
      };
    }
    function solve(p, revealed) {
      solved.add(p);
      if (revealed) p.revealed = true;
      current = puzzle.words.find((x) => !solved.has(x)) || p;
      draw();
      const inp = root.querySelector(".g-answer input");
      if (inp) inp.focus({ preventScroll: true });
    }
    start();
  }

  // ---- 4. 개념 짝 맞추기 ----
  function matchGame(root, concepts) {
    const N = Math.min(5, concepts.length);
    let set, pick, done, tries;
    const start = () => { set = shuffle(concepts).slice(0, N); pick = null; done = new Set(); tries = 0; draw(); };
    function draw() {
      const terms = shuffle(set), descs = shuffle(set);
      root.innerHTML = `
        <p class="muted g-small">용어를 고른 다음, 알맞은 설명을 누르세요.</p>
        <div class="mt-terms">${terms.map((c) => `<button type="button" data-t="${esc(c.term)}">${esc(c.term)}</button>`).join("")}</div>
        <ol class="mt-descs">${descs.map((c) => `<li><button type="button" data-d="${esc(c.term)}">${esc(c.desc)}</button></li>`).join("")}</ol>
        <p class="g-feedback" role="status"></p>`;
      root.onclick = (e) => {
        const t = e.target.closest("button[data-t]"), d = e.target.closest("button[data-d]");
        if (t && !done.has(t.dataset.t)) {
          pick = t.dataset.t;
          root.querySelectorAll("[data-t]").forEach((x) => x.classList.toggle("on", x === t));
        } else if (d && !done.has(d.dataset.d)) {
          const fb = root.querySelector(".g-feedback");
          if (!pick) { fb.className = "g-feedback"; fb.textContent = "먼저 위에서 용어를 골라 주세요."; return; }
          tries++;
          if (d.dataset.d === pick) {
            done.add(pick);
            root.querySelector(`[data-t="${CSS.escape(pick)}"]`).classList.replace("on", "ok");
            d.classList.add("ok");
            d.insertAdjacentHTML("afterbegin", `<b>${esc(pick)}</b> `);
            pick = null;
            fb.className = "g-feedback ok";
            fb.textContent = done.size === N ? `다 맞혔어요! ${tries}번 만에 ${N}쌍을 찾았어요.` : "맞았어요!";
            if (done.size === N) fb.insertAdjacentHTML("afterend", `<button type="button" class="primary g-again">새 문제</button>`);
          } else {
            fb.className = "g-feedback no";
            fb.textContent = "짝이 아니에요. 다시 골라 보세요.";
            d.classList.add("shake");
            setTimeout(() => d.classList.remove("shake"), 400);
          }
        } else if (e.target.closest(".g-again")) start();
      };
    }
    start();
  }

  const GAMES = [
    { id: "chosung", name: "개념 초성 퀴즈", desc: "설명과 초성을 보고 이번 호에 나온 개념을 맞혀요.", need: (k) => k.concepts.length >= 4, run: (el, k) => chosungGame(el, k.concepts.filter((c) => hangulOnly(c.term).length >= 2)) },
    { id: "english", name: "영어 헤드라인 빈칸", desc: "영어 기사 제목의 빈칸에 들어갈 낱말을 골라요.", need: (k) => k.heads.length >= 3, run: (el, k) => englishGame(el, k.heads) },
    { id: "crossword", name: "십자말풀이", desc: "개념 해설을 열쇠 삼아 가로·세로 낱말을 채워요.", need: (k) => k.concepts.length >= 6, run: (el, k) => crosswordGame(el, k.concepts) },
    { id: "match", name: "개념 짝 맞추기", desc: "용어와 설명을 짝지어요.", need: (k) => k.concepts.length >= 5, run: (el, k) => matchGame(el, k.concepts) },
  ];

  function mount(el, issue, label) {
    const kit = { concepts: conceptsOf(issue), heads: englishHeadlinesOf(issue) };
    const games = GAMES.filter((g) => g.need(kit));
    if (!games.length) { el.innerHTML = ""; return; }
    el.innerHTML = `
      <div class="section-label">뉴스 게임 <span class="g-issue">${esc(label)} 기사로 만든 문제</span></div>
      <h3>읽은 기사로 놀아 보기</h3>
      <div class="g-tabs" role="tablist">${games.map((g, i) => `<button type="button" role="tab" data-game="${g.id}" aria-selected="${i === 0}">${esc(g.name)}</button>`).join("")}</div>
      <p class="g-intro muted"></p>
      <div class="g-stage"></div>`;
    const stage = el.querySelector(".g-stage");
    const open = (id) => {
      const g = games.find((x) => x.id === id) || games[0];
      el.querySelectorAll("[data-game]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.game === g.id)));
      el.querySelector(".g-intro").textContent = g.desc;
      stage.onclick = null;
      g.run(stage, kit);
    };
    el.querySelector(".g-tabs").onclick = (e) => { const b = e.target.closest("[data-game]"); if (b) open(b.dataset.game); };
    open(games[0].id);
  }

  window.NewsGames = { mount, _test: { chosung, norm, buildCrossword, hangulOnly } };
})();
