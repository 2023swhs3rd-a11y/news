// 봉일천고 1학년 뉴스 읽고 진로 확장하기: 정적 데이터(data/*.json)를 읽어 필터링해 보여주고, 답안 제출을 받는다.
(function () {
  "use strict";

  const QTYPES = [
    { name: "알아보기", icon: "🔍" },
    { name: "연결하기", icon: "🔗" },
    { name: "확장하기", icon: "🚀" },
    { name: "비교하기", icon: "⚖️" },
    { name: "따져보기", icon: "🧐" },
  ];
  // 출처 카드: 기사 종류별 읽을 때 생각할 점 (원고의 links[].type)
  const LINK_TYPES = {
    "보도": "일어난 일을 전하는 기사예요. 누구의 말을 인용했는지 살펴보세요.",
    "해설": "기자가 배경과 의미를 풀어 쓴 기사예요. 사실과 기자의 해석을 나눠 읽어 보세요.",
    "칼럼": "글쓴이의 의견을 담은 글이에요. 주장과 근거를 구분해 보세요.",
    "인터뷰": "한 사람의 생각을 중심으로 한 글이에요. 다른 입장은 무엇일지 떠올려 보세요.",
    "보도자료": "기관이 직접 낸 글이에요. 그 기관에 유리한 내용 위주일 수 있어요.",
    "연구 소개": "연구 결과를 쉽게 소개한 글이에요. 원래 논문과 연구 대상·규모를 확인해 보세요.",
    "분석·보고서": "연구기관이 쓴 분석이에요. 누가 만든 기관인지, 어떤 자료를 썼는지 보세요.",
  };
  const QINDEX = Object.fromEntries(QTYPES.map((t, i) => [t.name, i]));
  const state = { view: "news", date: null, tracks: new Set(), major: "", q: "", openAll: false };
  let config = {};
  let tracks = [];
  let trackById = {};
  let majorGroups = {}; // 계열 id → 전공 목록 (data/majors.json)
  let issues = []; // data/index.json 의 호 목록 (기사는 추천·전공 집계용 요약만)
  const full = {}; // 발행일 → 전체 호 JSON 을 불러오는 Promise (필요할 때만 받는다)
  let renderSeq = 0;
  const PAGE = 20; // "모든 호" 보기에서 한 번에 그리는 기사 수
  let shown = PAGE;
  let pending = null; // 제출 창에 띄운 질문

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // 학번·이름은 "이 기기에 기억하기"를 고른 경우에만 localStorage 에 둔다 (교실 공용 PC 대비).
  // 작성 중인 답안은 탭을 닫으면 사라지는 sessionStorage 에 둔다.
  const storage = (kind) => ({
    get(k) { try { return window[kind].getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { if (v) window[kind].setItem(k, v); else window[kind].removeItem(k); } catch (e) { /* 저장 불가 환경 */ } },
  });
  const store = storage("localStorage");
  const drafts = storage("sessionStorage");

  async function getJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(path + " " + res.status);
    return res.json();
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    state.view = ["act", "game"].includes(p.get("view")) ? p.get("view") : "news";
    state.date = p.get("date") || null;
    state.tracks = new Set((p.get("track") || "").split(",").filter((t) => trackById[t]));
    state.major = p.get("major") || "";
    state.q = p.get("q") || "";
  }

  function writeHash() {
    const p = new URLSearchParams();
    if (state.view !== "news") p.set("view", state.view);
    if (state.date) p.set("date", state.date);
    if (state.tracks.size) p.set("track", [...state.tracks].join(","));
    if (state.major) p.set("major", state.major);
    if (state.q) p.set("q", state.q);
    const h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  function fmtDate(d) {
    const [y, m, day] = d.split("-");
    return `${y}년 ${Number(m)}월 ${Number(day)}일`;
  }

  function fmtShort(d) {
    const [, m, day] = d.split("-");
    return `${Number(m)}월 ${Number(day)}일`;
  }

  const issueLabel = (i) => (i.no ? `제${i.no}호` : fmtDate(i.date));
  const issueByDate = (d) => issues.find((i) => i.date === d);

  function loadIssue(d) {
    const meta = issueByDate(d);
    if (!full[d]) {
      full[d] = getJSON(meta.file).then((x) => Object.assign(x, { no: meta.no }));
      full[d].catch(() => { delete full[d]; }); // 실패하면 다음에 다시 시도
    }
    return full[d];
  }

  const colorOf = (id) => (trackById[id] && trackById[id].color) || "";

  function matchesTracks(itemTracks) {
    if (!state.tracks.size) return true;
    return (itemTracks || []).some((t) => state.tracks.has(t));
  }

  const matchesMajor = (a) => !state.major || (a.majors || []).includes(state.major);
  const matches = (a) => matchesTracks(a.tracks) && matchesMajor(a) && matchesQuery(a);

  function matchesQuery(a) {
    if (!state.q) return true;
    const q = state.q.toLowerCase();
    const hay = [a.title, a.summary, ...(a.majors || []),
      ...(a.curriculum || []).flatMap((c) => [c.subject, c.unit, ...(c.concepts || [])]),
      ...(a.questions || []).flatMap((x) => [x.q, ...(x.concepts || []).map((c) => c.term)]),
      ...(a.links || []).map((l) => l.label + " " + l.source)].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function renderChips() {
    const box = $("#track-chips");
    const all = `<button type="button" class="chip" data-track="" aria-pressed="${!state.tracks.size}">전체</button>`;
    box.innerHTML = all + tracks.map((t) =>
      `<button type="button" class="chip" style="--c:${t.color}" data-track="${t.id}" aria-pressed="${state.tracks.has(t.id)}" title="${esc(t.desc)}"><span class="dot" aria-hidden="true"></span>${esc(t.name)}</button>`
    ).join("");
  }

  function renderSelect() {
    const sel = $("#issue-select");
    sel.innerHTML = issues.map((i) =>
      `<option value="${i.date}">${issueLabel(i)} (${fmtShort(i.date)})</option>`).join("") + `<option value="all">모든 호 함께 보기</option>`;
    sel.value = state.date || "all";
  }

  // 실제 기사에 쓰인 전공만 계열별로 묶어 보여 준다
  function renderMajorSelect() {
    const count = {};
    issues.forEach((i) => i.articles.forEach((a) => (a.majors || []).forEach((m) => { count[m] = (count[m] || 0) + 1; })));
    const used = new Set();
    const opt = (m) => { used.add(m); return `<option value="${esc(m)}">${esc(m)} (${count[m]})</option>`; };
    const groups = tracks.map((t) => {
      const ms = (majorGroups[t.id] || []).filter((m) => count[m] && !used.has(m));
      return ms.length ? `<optgroup label="${esc(t.name)}">${ms.map(opt).join("")}</optgroup>` : "";
    }).join("");
    const rest = Object.keys(count).filter((m) => !used.has(m)).sort();
    const sel = $("#major-select");
    sel.innerHTML = `<option value="">모든 전공</option>` + groups +
      (rest.length ? `<optgroup label="기타">${rest.map(opt).join("")}</optgroup>` : "");
    sel.hidden = !Object.keys(count).length;
    sel.value = count[state.major] ? state.major : "";
  }

  function questionHTML(x, a, date, qi) {
    const concepts = (x.concepts || []).length ? `
      <div class="concepts"><h4>개념 해설</h4><dl>${x.concepts.map((c) =>
        `<dt>${esc(c.term)}</dt><dd>${esc(c.desc)}</dd>`).join("")}</dl></div>` : "";
    const submit = config.submitUrl
      ? `<button type="button" class="submit-btn" data-date="${date}" data-article="${esc(a.id)}" data-q="${qi}">답안 제출</button>` : "";
    return `
      <li class="q">
        <div class="qtype"><span class="qnum">${(QINDEX[x.type] ?? 0) + 1}</span>${esc(x.type)}</div><p class="qtext">${esc(x.q)}</p>
        <div class="q-actions">
          ${submit}
          ${x.a ? `<details${state.openAll ? " open" : ""}><summary>예시 답안${concepts ? " · 개념 해설" : ""}</summary><div class="answer">${esc(x.a)}</div>${concepts}</details>` : ""}
        </div>
      </li>`;
  }

  // 출처 카드: 매체 종류(build.py 가 sources.json 에서 채움), 기사 종류, 유료 여부
  function linkHTML(l) {
    const meta = [
      esc(l.source),
      l.kind ? esc(l.kind) : "",
      l.type ? `<span class="src-type" tabindex="0" title="${esc(LINK_TYPES[l.type] || "")}">${esc(l.type)}</span>` : "",
      l.paywall ? `<span class="paywall" title="구독해야 끝까지 읽을 수 있어요">유료</span>` : "",
      l.lang === "en" ? '<span class="lang">EN</span>' : "",
    ].filter(Boolean).join('<span class="sep">·</span>');
    return `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.title)}</a><span class="src-meta">${meta}</span></li>`;
  }

  // 한 사건, 여러 시선: 같은 사건을 다룬 국내·해외 기사를 나란히 놓고 따져 보는 코너
  function compareArticle(issue) {
    const c = issue.compare;
    if (!c) return null;
    return { id: "compare", title: c.title, tracks: c.tracks || [], questions: [{ type: "따져보기", q: c.q, a: c.a, concepts: c.concepts }] };
  }

  function compareHTML(issue) {
    const c = issue.compare;
    if (!c || !matchesTracks(c.tracks)) return "";
    const items = c.items.map((it) => `
      <div class="cmp-item">
        <div class="cmp-src"><b>${esc(it.source)}</b>${it.kind ? `<span class="sep">·</span>${esc(it.kind)}` : ""}${it.lang === "en" ? '<span class="lang">EN</span>' : ""}</div>
        <a class="cmp-title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
        ${it.lead ? `<p class="cmp-lead">${esc(it.lead)}</p>` : ""}
        ${it.focus ? `<p class="cmp-focus"><b>강조한 점</b> ${esc(it.focus)}</p>` : ""}
      </div>`).join("");
    return `
      <section class="compare card" id="compare">
        <div class="section-label">한 사건, 여러 시선</div>
        <h3>${esc(c.title)}</h3>
        ${c.intro ? `<p class="summary">${esc(c.intro)}</p>` : ""}
        <div class="cmp-grid">${items}</div>
        <ol class="questions">${questionHTML(compareArticle(issue).questions[0], compareArticle(issue), issue.date, 0)}</ol>
      </section>`;
  }

  const HOWTO = `
    <details class="howto"><summary>기사를 따져 읽는 세 가지 질문</summary>
      <ol>
        <li><b>누가 썼나?</b> 매체와 기사 종류(보도·해설·칼럼·보도자료·연구 소개)를 확인해요. 링크 옆 꼬리표에 마우스를 올리거나 눌러 보세요.</li>
        <li><b>근거는 무엇인가?</b> 숫자와 인용이 어디서 왔는지, 원자료가 있는지 찾아봐요.</li>
        <li><b>다른 곳은 뭐라고 하나?</b> 새 탭을 열어 같은 소식을 다른 매체에서 검색해 봐요.</li>
      </ol>
      <p class="muted">요약과 예시 답안은 AI가 초안을 쓰고 선생님이 검토했어요. 원문과 비교해 빠진 내용이 없는지 확인하는 것도 좋은 연습이에요.</p>
    </details>`;

  // 데이터로 더 보기: 빅카인즈에서 학생이 직접 검색·분석해 보는 개별 과제 (원고의 explore, 데이터로 볼 만한 기사에만)
  const BIGKINDS = "https://www.bigkinds.or.kr/";
  function exploreHTML(a, date) {
    const x = a.explore;
    if (!x || !(x.keywords || []).length) return "";
    const submit = config.submitUrl
      ? `<button type="button" class="submit-btn" data-date="${date}" data-explore="${esc(a.id)}">결과 제출</button>` : "";
    return `
      <div class="explore">
        <div class="explore-head"><b>데이터로 더 보기</b><span class="muted">개별 과제 · 빅카인즈(한국언론진흥재단)</span></div>
        <p class="explore-kw">검색어 ${x.keywords.map((k) => `<button type="button" class="kw" data-copy="${esc(k)}" title="눌러서 복사">${esc(k)}</button>`).join(" ")}</p>
        <ol class="explore-tasks">${(x.tasks || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
        <p class="muted explore-note">검색어를 빅카인즈 뉴스 검색에 넣고 기간을 최근 5년으로 정한 뒤, 뉴스 분석의 키워드 트렌드·연관어 분석을 열어 보세요. 분석 화면을 쓸 수 없으면 검색 결과의 기사 수와 제목만으로 답해도 돼요.</p>
        <div class="q-actions"><a class="act-go" href="${BIGKINDS}" target="_blank" rel="noopener">빅카인즈 열기 ↗</a>${submit}</div>
      </div>`;
  }

  function articleHTML(a, date, showDate) {
    const main = (a.tracks || [])[0];
    const badges = (a.tracks || []).map((t) => trackById[t]
      ? `<span class="badge" style="--c:${colorOf(t)}">${esc(trackById[t].name)}</span>` : "").join("");
    const dateBadge = showDate ? `<a class="badge date" href="#date=${date}">${issueLabel(issueByDate(date))}</a>` : "";
    const links = (a.links || []).map(linkHTML).join("");
    const evidence = (a.evidence || []).length ? `<div class="evidence"><span class="muted">기사가 근거로 쓴 원자료</span> ${a.evidence.map((e) =>
      `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.label)}</a>`).join(" · ")}</div>` : "";
    const curr = (a.curriculum || []).map((c) =>
      `<li><b>${esc(c.subject)}</b>${c.unit ? ` <span class="muted">${esc(c.unit)}</span>` : ""}${(c.concepts || []).length ? `<span class="curr-concepts">${c.concepts.map(esc).join(" · ")}</span>` : ""}</li>`).join("");
    const majors = (a.majors || []).length ? `<div class="majors"><span class="muted">관련 전공</span>${a.majors.map((m) =>
      `<button type="button" class="major-tag" data-major="${esc(m)}" aria-pressed="${state.major === m}">#${esc(m)}</button>`).join("")}</div>` : "";
    const qs = (a.questions || []).map((x, i) => ({ x, i }))
      .sort((p, q) => (QINDEX[p.x.type] ?? 9) - (QINDEX[q.x.type] ?? 9))
      .map(({ x, i }) => questionHTML(x, a, date, i)).join("");
    return `
      <article class="card" id="${esc(a.id)}" style="--c:${colorOf(main)}">
        <div class="badges">${dateBadge}${badges}</div>
        <h3>${esc(a.title)}</h3>
        <p class="summary">${esc(a.summary)}</p>
        ${majors}
        <div class="section-label">기사 읽기</div>
        <ul class="links">${links}</ul>
        ${evidence}
        ${exploreHTML(a, date)}
        <div class="section-label">교과서와 연결</div>
        <ul class="curr">${curr}</ul>
        <div class="section-label">탐구 질문</div>
        <ol class="questions">${qs}</ol>
        ${relatedHTML(a, date)}
      </article>`;
  }

  // 비슷한 주제 기사: 계열·과목·개념이 겹칠수록 점수가 높다
  function keywords(a) {
    if (a.k) return new Set(a.k); // index.json 에 미리 계산된 키
    const set = new Set();
    (a.tracks || []).forEach((t) => set.add("t:" + t));
    (a.majors || []).forEach((m) => set.add("m:" + m));
    (a.curriculum || []).forEach((c) => {
      set.add("s:" + c.subject);
      (c.concepts || []).forEach((k) => set.add("k:" + k));
    });
    (a.questions || []).forEach((q) => (q.concepts || []).forEach((c) => set.add("k:" + c.term)));
    return set;
  }
  const WEIGHT = { t: 2, m: 3, s: 2, k: 3 };

  function related(a, date) {
    const mine = keywords(a);
    return issues.flatMap((i) => i.articles.map((b) => ({ b, date: i.date })))
      .filter(({ b, date: d }) => !(b.id === a.id && d === date))
      .map(({ b, date: d }) => {
        let score = 0;
        keywords(b).forEach((k) => { if (mine.has(k)) score += WEIGHT[k[0]]; });
        return { b, date: d, score };
      })
      .filter((r) => r.score >= 3)
      .sort((x, y) => y.score - x.score || y.date.localeCompare(x.date))
      .slice(0, 3);
  }

  function relatedHTML(a, date) {
    const list = related(a, date);
    if (!list.length) return "";
    return `<div class="related"><div class="section-label">비슷한 주제 기사</div><ul>${list.map(({ b, date: d }) => {
      const t = trackById[(b.tracks || [])[0]];
      return `<li><a href="#date=${d}" class="jump" data-date="${d}" data-id="${esc(b.id)}">${esc(b.title)}</a> <span class="muted">· ${issueLabel(issueByDate(d))}</span></li>`;
    }).join("")}</ul></div>`;
  }

  async function jumpTo(d, id) {
    state.date = d;
    state.tracks.clear();
    state.major = "";
    state.q = "";
    $("#search").value = "";
    $("#major-select").value = "";
    $("#issue-select").value = d;
    await update();
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function readingHTML(list) {
    if (!list.length) return "";
    return `<section class="reading"><h3>더 읽을거리 <small class="muted">연구소 보고서</small></h3><ul class="links">${list.map((r) =>
      `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a><span class="src-meta">${esc(r.source)}${r.note ? '<span class="sep">·</span>' + esc(r.note) : ""}${r.lang === "en" ? '<span class="sep">·</span><span class="lang">EN</span>' : ""}</span></li>`).join("")}</ul></section>`;
  }

  let activities = null; // data/activities.json (추가 활동 탭을 열 때 받는다)

  function activityHTML(x) {
    const tags = [x.skill, ...(x.subjects || [])].map(esc).join(" · ");
    const submit = config.submitUrl ? `<button type="button" class="submit-btn" data-act="${esc(x.id)}">활동 결과 제출</button>` : "";
    return `
      <article class="card activity" id="act-${esc(x.id)}">
        <div class="act-provider muted">${esc(x.provider)}${x.lang === "en" ? '<span class="sep">·</span><span class="lang">EN</span>' : ""}</div>
        <h3><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></h3>
        <p class="summary">${esc(x.desc)}</p>
        <p class="act-tags muted">${tags}</p>
        ${x.when ? `<p class="muted act-when">${esc(x.when)}</p>` : ""}
        <div class="section-label">이렇게 해 봐요</div>
        <ol class="act-prompts">${(x.prompts || []).map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
        <div class="q-actions"><a class="act-go" href="${esc(x.url)}" target="_blank" rel="noopener">활동하러 가기 ↗</a>${submit}</div>
      </article>`;
  }

  async function renderActivities(main, seq) {
    try {
      activities = activities || (await getJSON("data/activities.json")).activities;
    } catch (e) {
      if (seq === renderSeq) main.innerHTML = `<p class="empty">활동 목록을 불러오지 못했어요. 새로고침해 주세요.</p>`;
      return;
    }
    if (seq !== renderSeq) return;
    main.innerHTML = `
      <section class="issue-head">
        <h2>추가 활동</h2>
        <p>뉴스를 더 깊이 읽고 싶은 친구를 위한 활동이에요. 매주 새 그래프와 사진, 사실 확인 사례가 올라와요. 질문에 답하고 선생님께 제출해 보세요.</p>
      </section>
      ${activities.map(activityHTML).join("")}`;
  }

  // 뉴스 게임 탭: 고른 호(모든 호 보기면 최신 호)의 개념 해설과 영어 기사 제목으로 문제를 만든다
  async function renderGames(main, seq) {
    const meta = issueByDate(state.date) || issues[0];
    if (!meta || !window.NewsGames) { main.innerHTML = `<p class="empty">아직 게임을 만들 기사가 없어요.</p>`; return; }
    let issue;
    try {
      issue = await loadIssue(meta.date);
    } catch (e) {
      if (seq === renderSeq) main.innerHTML = `<p class="empty">기사를 불러오지 못했어요. 새로고침해 주세요.</p>`;
      return;
    }
    if (seq !== renderSeq) return;
    main.innerHTML = `
      <section class="issue-head">
        <div class="date"><b>${issueLabel(issue)}</b> · ${fmtDate(issue.date)} 발행</div>
        <h2>뉴스 게임</h2>
        <p>이번 호 기사에 나온 개념과 영어 기사 제목으로 만든 게임이에요. 기사를 읽고 나서 얼마나 기억하는지 확인해 보세요. 위에서 발행 호를 바꾸면 그 호의 문제로 바뀌어요.</p>
      </section>
      <section class="card games" id="games" aria-label="뉴스 게임"></section>`;
    window.NewsGames.mount($("#games"), issue, issueLabel(issue));
  }

  async function render() {
    const main = $("#content");
    document.body.classList.toggle("view-act", state.view === "act");
    document.body.classList.toggle("view-game", state.view === "game");
    document.querySelectorAll("#view-tabs [data-view]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    if (state.view === "act") return renderActivities(main, ++renderSeq);
    if (state.view === "game") return renderGames(main, ++renderSeq);
    if (!issues.length) { main.innerHTML = `<p class="empty">아직 발행된 호가 없습니다.</p>`; return; }
    const seq = ++renderSeq;
    const all = !state.date || state.date === "all";
    const dates = all ? issues.map((i) => i.date) : [(issueByDate(state.date) || issues[0]).date];
    let loaded;
    try {
      const pending = Promise.all(dates.map(loadIssue));
      const slow = setTimeout(() => { if (seq === renderSeq) main.innerHTML = `<p class="muted">불러오는 중…</p>`; }, 150);
      loaded = await pending;
      clearTimeout(slow);
    } catch (e) {
      if (seq === renderSeq) main.innerHTML = `<p class="empty">기사를 불러오지 못했어요. 인터넷 연결을 확인하고 <a href="">새로고침</a>해 주세요.</p>`;
      return;
    }
    if (seq !== renderSeq) return; // 그사이 필터가 바뀌었으면 버린다

    if (!all) {
      const issue = loaded[0];
      const arts = issue.articles.filter(matches);
      const reading = (issue.reading || []).filter((r) => matchesTracks(r.tracks));
      const filtered = state.tracks.size || state.major || state.q;
      const elsewhere = state.major ? issues.filter((i) => i.date !== issue.date)
        .reduce((n, i) => n + i.articles.filter((a) => matchesTracks(a.tracks) && matchesMajor(a)).length, 0) : 0;
      const more = elsewhere > 0 ? `<p class="more-hint">다른 호에도 <b>${esc(state.major)}</b> 관련 기사가 ${elsewhere}개 더 있어요. <a href="#" class="show-all">모든 호에서 보기</a></p>` : "";
      main.innerHTML = `
        <section class="issue-head">
          <div class="date"><b>${issueLabel(issue)}</b> · ${fmtDate(issue.date)} 발행 · <span class="nowrap">다룬 기간 ${esc(issue.period || "")}</span></div>
          <h2>${esc(issue.title)}</h2>
          <p>${esc(issue.intro || "")}</p>
        </section>
        ${!filtered && issue.headlines && issue.headlines.length ? `<section class="headlines"><h3>이번 주 헤드라인</h3><ol>${issue.headlines.map(linkHTML).join("")}</ol></section>` : ""}
        ${HOWTO}
        ${state.major || state.q ? "" : compareHTML(issue)}
        ${arts.length ? arts.map((a) => articleHTML(a, issue.date, false)).join("") : `<p class="empty">조건에 맞는 기사가 없어요.</p>`}
        ${more}
        ${readingHTML(reading)}`;
    } else {
      const rows = loaded.flatMap((i) => i.articles.map((a) => ({ a, date: i.date })))
        .filter(({ a }) => matches(a));
      main.innerHTML = `<section class="issue-head"><h2>모든 호</h2><p class="muted">${issues.length}개 호에서 ${rows.length}개 기사</p></section>` +
        (rows.length ? rows.slice(0, shown).map(({ a, date }) => articleHTML(a, date, true)).join("") : `<p class="empty">조건에 맞는 기사가 없어요.</p>`) +
        (rows.length > shown ? `<button type="button" class="more-btn" id="more-btn">기사 더 보기 (${rows.length - shown}개 남음)</button>` : "");
    }
    $("#toggle-answers").textContent = state.openAll ? "예시 답안 모두 접기" : "예시 답안 모두 펼치기";
  }

  function renderFooter() {
    const parts = [];
    if (config.version) parts.push(`버전 ${esc(config.version)}`);
    if (config.buildDate) parts.push(`업데이트 ${esc(config.buildDate)}`);
    if (config.author) parts.push(`만든 곳 ${esc(config.author)}`);
    $("#site-meta").innerHTML = parts.join(" · ");
  }

  function update() { shown = PAGE; writeHash(); renderChips(); return render(); }

  // ---- 답안 제출 ----
  async function openSubmit(btn) {
    if (btn.dataset.act) {
      const x = (activities || []).find((v) => v.id === btn.dataset.act);
      if (x) showSubmit({ issue: { date: "추가활동" }, a: { id: "act-" + x.id, title: x.title, tracks: [] }, q: { type: "추가활동", q: "\n" + (x.prompts || []).map((p, i) => `${i + 1}. ${p}`).join("\n") } });
      return;
    }
    const issue = await loadIssue(btn.dataset.date).catch(() => null);
    if (btn.dataset.explore) {
      const art = issue && issue.articles.find((x) => x.id === btn.dataset.explore);
      if (art && art.explore) showSubmit({ issue, a: art, q: { type: "데이터 탐구", q: `\n검색어: ${art.explore.keywords.join(", ")}\n` + art.explore.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n") } });
      return;
    }
    const a = issue && (btn.dataset.article === "compare" ? compareArticle(issue) : issue.articles.find((x) => x.id === btn.dataset.article));
    const q = a && a.questions[Number(btn.dataset.q)];
    if (q) showSubmit({ issue, a, q });
  }

  function showSubmit(p) {
    pending = p;
    const { q } = p;
    const form = $("#submit-form");
    $("#submit-question").textContent = `[${q.type}] ${q.q}`;
    form.studentId.value = store.get("studentId");
    form.name.value = store.get("name");
    form.remember.checked = !!store.get("studentId");
    form.answer.value = drafts.get(draftKey());
    $("#submit-status").textContent = "";
    $("#submit-send").disabled = false;
    $("#submit-dialog").showModal();
    (form.studentId.value ? form.answer : form.studentId).focus();
  }

  const draftKey = () => pending ? `draft:${pending.issue.date}:${pending.a.id}:${pending.q.type}` : "";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // 한 번 보내고 서버 응답을 읽는다. 서버가 바쁘다고 하면(동시 제출이 몰릴 때) 잠시 뒤 다시 보낸다.
  async function post(payload) {
    for (let attempt = 0; ; attempt++) {
      let res = null;
      try {
        const r = await fetch(config.submitUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
        res = r.ok ? await r.json() : { ok: false, busy: r.status === 429 || r.status >= 500 };
      } catch (err) {
        return { ok: false, network: true };
      }
      if (res.ok || !res.busy || attempt >= 3) return res;
      $("#submit-status").textContent = `제출하는 친구들이 많아 기다리는 중… (${attempt + 1}/3)`;
      await sleep(1500 * 2 ** attempt + Math.random() * 1500);
    }
  }

  async function sendSubmit(e) {
    e.preventDefault();
    const form = $("#submit-form");
    if (!form.reportValidity() || !pending) return;
    const answer = form.answer.value.trim();
    // 같은 답안을 다시 보내도 시트에 한 번만 쌓이도록 서버가 이 번호로 중복을 거른다. 답안을 고치면 새 번호.
    if (!pending.sid || pending.sent !== answer) { pending.sid = newId(); pending.sent = answer; }
    const payload = {
      sid: pending.sid,
      issueDate: pending.issue.date,
      tracks: pending.a.tracks.map((t) => trackById[t] ? trackById[t].name : t).join(", "),
      article: pending.a.title,
      qtype: pending.q.type,
      question: pending.q.q,
      studentId: form.studentId.value.trim(),
      name: form.name.value.trim(),
      answer,
      website: form.website.value,
    };
    const remember = form.remember.checked;
    store.set("studentId", remember ? payload.studentId : "");
    store.set("name", remember ? payload.name : "");
    $("#submit-send").disabled = true;
    $("#submit-status").textContent = "보내는 중…";
    const res = await post(payload);
    if (res.ok) {
      drafts.set(draftKey(), "");
      pending.sid = null;
      $("#submit-status").textContent = "✅ 선생님께 제출했어요! 이제 예시 답안과 비교해 보세요.";
      setTimeout(() => $("#submit-dialog").close(), 1800);
      return;
    }
    $("#submit-status").textContent = res.network
      ? "⚠️ 제출됐는지 확인하지 못했어요. 인터넷 연결을 확인하고 한 번 더 눌러 주세요. 같은 답안은 한 번만 저장돼요."
      : `⚠️ ${res.error || "지금은 제출이 어려워요. 잠시 뒤 다시 눌러 주세요."} (작성한 내용은 남아 있어요)`;
    $("#submit-send").disabled = false;
  }

  async function init() {
    try {
      const [cfg, trk, index, mj] = await Promise.all([
        getJSON("data/config.json").catch(() => ({})), getJSON("data/tracks.json"), getJSON("data/index.json"),
        getJSON("data/majors.json").catch(() => ({}))]);
      config = cfg;
      majorGroups = mj;
      tracks = trk;
      trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));
      issues = index.issues.slice().sort((x, y) => y.date.localeCompare(x.date));
    } catch (e) {
      $("#content").innerHTML = `<p class="empty">데이터를 불러오지 못했습니다. (${esc(e.message)})</p>`;
      return;
    }
    renderFooter();
    // 예전 버전이 localStorage 에 남긴 작성 중 답안을 지운다 (공용 PC 에서 다음 학생에게 보이지 않도록)
    try { Object.keys(localStorage).filter((k) => k.startsWith("draft:")).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* 무시 */ }
    readHash();
    if (!state.date && issues.length) state.date = issues[0].date;
    $("#search").value = state.q;
    renderSelect();
    renderMajorSelect();
    update();

    $("#view-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-view]");
      if (!b || b.dataset.view === state.view) return;
      state.view = b.dataset.view;
      update();
      window.scrollTo(0, 0);
    });
    $("#issue-select").addEventListener("change", (e) => { state.date = e.target.value; update(); window.scrollTo(0, 0); });
    $("#track-chips").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-track]");
      if (!b) return;
      const t = b.dataset.track;
      if (!t) state.tracks.clear();
      else if (state.tracks.has(t)) state.tracks.delete(t);
      else state.tracks.add(t);
      update();
    });
    $("#major-select").addEventListener("change", (e) => { state.major = e.target.value; update(); });
    let timer;
    $("#search").addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 200);
    });
    $("#toggle-answers").addEventListener("click", () => {
      state.openAll = !state.openAll;
      document.querySelectorAll("#content details").forEach((d) => { d.open = state.openAll; });
      $("#toggle-answers").textContent = state.openAll ? "예시 답안 모두 접기" : "예시 답안 모두 펼치기";
    });
    $("#content").addEventListener("click", (e) => {
      const kw = e.target.closest(".kw[data-copy]");
      if (kw && navigator.clipboard) {
        navigator.clipboard.writeText(kw.dataset.copy).then(() => {
          kw.classList.add("copied");
          setTimeout(() => kw.classList.remove("copied"), 1500);
        }).catch(() => {});
      }
      const b = e.target.closest(".submit-btn");
      if (b) openSubmit(b);
      const j = e.target.closest("a.jump");
      if (j) { e.preventDefault(); jumpTo(j.dataset.date, j.dataset.id); }
      const m = e.target.closest(".major-tag");
      if (m) {
        state.major = state.major === m.dataset.major ? "" : m.dataset.major;
        $("#major-select").value = state.major;
        update();
        $("#content").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (e.target.closest("#more-btn")) {
        shown += PAGE;
        render();
      }
      if (e.target.closest("a.show-all")) {
        e.preventDefault();
        state.date = "all";
        $("#issue-select").value = "all";
        update();
      }
    });
    $("#submit-form").addEventListener("submit", sendSubmit);
    $("#submit-form").answer.addEventListener("input", (e) => drafts.set(draftKey(), e.target.value));
    $("#submit-cancel").addEventListener("click", () => $("#submit-dialog").close());
    const top = $("#to-top");
    window.addEventListener("scroll", () => { top.hidden = window.scrollY < 600; }, { passive: true });
    top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    window.addEventListener("hashchange", () => { readHash(); if (!state.date) state.date = issues[0].date; $("#issue-select").value = state.date; $("#major-select").value = state.major; renderChips(); render(); });
  }

  init();
})();
