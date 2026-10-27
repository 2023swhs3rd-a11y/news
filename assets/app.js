// 봉일천고 1학년 뉴스 읽고 진로 확장하기: 정적 데이터(data/*.json)를 읽어 필터링해 보여주고, 답안 제출을 받는다.
(function () {
  "use strict";

  const QTYPES = [
    { name: "알아보기", icon: "🔍" },
    { name: "연결하기", icon: "🔗" },
    { name: "확장하기", icon: "🚀" },
    { name: "비교하기", icon: "⚖️" },
  ];
  const QINDEX = Object.fromEntries(QTYPES.map((t, i) => [t.name, i]));
  const state = { date: null, tracks: new Set(), q: "", openAll: false };
  let config = {};
  let tracks = [];
  let trackById = {};
  let issues = [];
  let pending = null; // 제출 창에 띄운 질문

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const store = {
    get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 */ } },
  };

  async function getJSON(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(path + " " + res.status);
    return res.json();
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    state.date = p.get("date") || null;
    state.tracks = new Set((p.get("track") || "").split(",").filter((t) => trackById[t]));
    state.q = p.get("q") || "";
  }

  function writeHash() {
    const p = new URLSearchParams();
    if (state.date) p.set("date", state.date);
    if (state.tracks.size) p.set("track", [...state.tracks].join(","));
    if (state.q) p.set("q", state.q);
    const h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  function fmtDate(d) {
    const [y, m, day] = d.split("-");
    return `${y}년 ${Number(m)}월 ${Number(day)}일`;
  }

  const colorOf = (id) => (trackById[id] && trackById[id].color) || "";

  function matchesTracks(itemTracks) {
    if (!state.tracks.size) return true;
    return (itemTracks || []).some((t) => state.tracks.has(t));
  }

  function matchesQuery(a) {
    if (!state.q) return true;
    const q = state.q.toLowerCase();
    const hay = [a.title, a.summary,
      ...(a.curriculum || []).flatMap((c) => [c.subject, c.unit, ...(c.concepts || [])]),
      ...(a.questions || []).flatMap((x) => [x.q, ...(x.concepts || []).map((c) => c.term)]),
      ...(a.links || []).map((l) => l.label + " " + l.source)].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function renderChips() {
    const box = $("#track-chips");
    const all = `<button type="button" class="chip" data-track="" aria-pressed="${!state.tracks.size}">🌈 전체</button>`;
    box.innerHTML = all + tracks.map((t) =>
      `<button type="button" class="chip" style="--c:${t.color}" data-track="${t.id}" aria-pressed="${state.tracks.has(t.id)}" title="${esc(t.desc)}">${t.emoji} ${esc(t.name)}</button>`
    ).join("");
  }

  function renderSelect() {
    const sel = $("#issue-select");
    sel.innerHTML = `<option value="all">모든 호 보기</option>` + issues.map((i) =>
      `<option value="${i.date}">${fmtDate(i.date)} · ${esc(i.title)}</option>`).join("");
    sel.value = state.date || "all";
  }

  function questionHTML(x, a, date, qi) {
    const t = QTYPES[QINDEX[x.type]] || { icon: "❓" };
    const concepts = (x.concepts || []).length ? `
      <div class="concepts"><h4>📘 개념 해설</h4><dl>${x.concepts.map((c) =>
        `<dt>${esc(c.term)}</dt><dd>${esc(c.desc)}</dd>`).join("")}</dl></div>` : "";
    const submit = config.submitUrl
      ? `<button type="button" class="submit-btn" data-date="${date}" data-article="${esc(a.id)}" data-q="${qi}">✍️ 내 답안 제출</button>` : "";
    return `
      <li class="q">
        <span class="qtype t${(QINDEX[x.type] || 0) + 1}">${t.icon} ${esc(x.type)}</span><span class="qtext">${esc(x.q)}</span>
        <div class="q-actions">
          ${submit}
          ${x.a ? `<details${state.openAll ? " open" : ""}><summary>💡 예시 답안${concepts ? " · 개념 해설" : ""} 보기</summary><div class="answer">${esc(x.a)}</div>${concepts}</details>` : ""}
        </div>
      </li>`;
  }

  function articleHTML(a, date, showDate) {
    const main = (a.tracks || [])[0];
    const badges = (a.tracks || []).map((t) => trackById[t]
      ? `<span class="badge" style="--c:${colorOf(t)}">${trackById[t].emoji} ${esc(trackById[t].name)}</span>` : "").join("");
    const dateBadge = showDate ? `<a class="badge date" href="#date=${date}">${fmtDate(date)} 호</a>` : "";
    const links = (a.links || []).map((l) =>
      `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a> <span class="muted">· ${esc(l.source)}</span>${l.lang === "en" ? '<span class="lang">EN</span>' : ""}</li>`).join("");
    const curr = (a.curriculum || []).map((c) =>
      `<div class="curr-item"><b>📗 ${esc(c.subject)}</b>${c.unit ? ` <span class="muted">› ${esc(c.unit)}</span>` : ""}<br>${(c.concepts || []).map((k) => `<span class="concept-tag">${esc(k)}</span>`).join("")}</div>`).join("");
    const qs = (a.questions || []).map((x, i) => ({ x, i }))
      .sort((p, q) => (QINDEX[p.x.type] ?? 9) - (QINDEX[q.x.type] ?? 9))
      .map(({ x, i }) => questionHTML(x, a, date, i)).join("");
    return `
      <article class="card" id="${esc(a.id)}" style="--c:${colorOf(main)}">
        <div class="card-head">
          <div class="track-icon" aria-hidden="true">${trackById[main] ? trackById[main].emoji : "📰"}</div>
          <div>
            <div class="badges">${dateBadge}${badges}</div>
            <h3>${esc(a.title)}</h3>
          </div>
        </div>
        <p class="summary">${esc(a.summary)}</p>
        <div class="section-label">📰 기사 읽기</div>
        <ul class="links">${links}</ul>
        <div class="section-label">🏫 교과서와 연결</div>
        <div class="curr">${curr}</div>
        <div class="section-label">💭 탐구 질문</div>
        <ol class="questions">${qs}</ol>
      </article>`;
  }

  function readingHTML(list) {
    if (!list.length) return "";
    return `<section class="reading"><h3>📚 더 읽을거리 (연구소 보고서)</h3><ul class="links">${list.map((r) =>
      `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a> <span class="muted">· ${esc(r.source)}${r.note ? " · " + esc(r.note) : ""}</span>${r.lang === "en" ? '<span class="lang">EN</span>' : ""}</li>`).join("")}</ul></section>`;
  }

  function render() {
    const main = $("#content");
    if (!issues.length) { main.innerHTML = `<p class="empty">아직 발행된 호가 없습니다.</p>`; return; }

    if (state.date && state.date !== "all") {
      const issue = issues.find((i) => i.date === state.date) || issues[0];
      const arts = issue.articles.filter((a) => matchesTracks(a.tracks) && matchesQuery(a));
      const reading = (issue.reading || []).filter((r) => matchesTracks(r.tracks));
      const filtered = state.tracks.size || state.q;
      main.innerHTML = `
        <section class="issue-head">
          <div class="date">🗞️ ${fmtDate(issue.date)} 발행 · 다룬 기간 ${esc(issue.period || "")}</div>
          <h2>${esc(issue.title)}</h2>
          <p>${esc(issue.intro || "")}</p>
        </section>
        ${!filtered && issue.headlines && issue.headlines.length ? `<section class="headlines"><h3>⚡ 이번 주 헤드라인</h3><ul>${issue.headlines.map((h) =>
          `<li><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="muted">· ${esc(h.source)}</span>${h.lang === "en" ? '<span class="lang">EN</span>' : ""}</li>`).join("")}</ul></section>` : ""}
        ${arts.length ? arts.map((a) => articleHTML(a, issue.date, false)).join("") : `<p class="empty">🤔 조건에 맞는 기사가 없어요.</p>`}
        ${readingHTML(reading)}`;
    } else {
      const rows = issues.flatMap((i) => i.articles.map((a) => ({ a, date: i.date })))
        .filter(({ a }) => matchesTracks(a.tracks) && matchesQuery(a));
      main.innerHTML = `<section class="issue-head"><h2>모든 호</h2><p class="muted">${issues.length}개 호에서 ${rows.length}개 기사</p></section>` +
        (rows.length ? rows.map(({ a, date }) => articleHTML(a, date, true)).join("") : `<p class="empty">🤔 조건에 맞는 기사가 없어요.</p>`);
    }
    $("#toggle-answers").textContent = state.openAll ? "💡 예시 답안 모두 접기" : "💡 예시 답안 모두 펼치기";
  }

  function update() { writeHash(); renderChips(); render(); }

  // ---- 답안 제출 ----
  function openSubmit(btn) {
    const issue = issues.find((i) => i.date === btn.dataset.date);
    const a = issue && issue.articles.find((x) => x.id === btn.dataset.article);
    const q = a && a.questions[Number(btn.dataset.q)];
    if (!q) return;
    pending = { issue, a, q };
    const form = $("#submit-form");
    $("#submit-question").textContent = `[${q.type}] ${q.q}`;
    form.studentId.value = store.get("studentId");
    form.name.value = store.get("name");
    form.answer.value = store.get(draftKey());
    $("#submit-status").textContent = "";
    $("#submit-send").disabled = false;
    $("#submit-dialog").showModal();
    (form.studentId.value ? form.answer : form.studentId).focus();
  }

  const draftKey = () => pending ? `draft:${pending.issue.date}:${pending.a.id}:${pending.q.type}` : "";

  async function sendSubmit(e) {
    e.preventDefault();
    const form = $("#submit-form");
    if (!form.reportValidity() || !pending) return;
    const payload = {
      issueDate: pending.issue.date,
      tracks: pending.a.tracks.map((t) => trackById[t] ? trackById[t].name : t).join(", "),
      article: pending.a.title,
      qtype: pending.q.type,
      question: pending.q.q,
      studentId: form.studentId.value.trim(),
      name: form.name.value.trim(),
      answer: form.answer.value.trim(),
      website: form.website.value,
    };
    store.set("studentId", payload.studentId);
    store.set("name", payload.name);
    $("#submit-send").disabled = true;
    $("#submit-status").textContent = "보내는 중…";
    try {
      // Apps Script 웹 앱은 CORS 응답을 주지 않으므로 no-cors 로 보내고 응답은 확인하지 않는다
      await fetch(config.submitUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
      store.set(draftKey(), "");
      $("#submit-status").textContent = "✅ 제출했어요! 이제 예시 답안과 비교해 보세요.";
      setTimeout(() => $("#submit-dialog").close(), 1600);
    } catch (err) {
      $("#submit-status").textContent = "⚠️ 제출하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. (작성한 내용은 저장되어 있어요)";
      $("#submit-send").disabled = false;
    }
  }

  async function init() {
    try {
      const [cfg, trk, index] = await Promise.all([
        getJSON("data/config.json").catch(() => ({})), getJSON("data/tracks.json"), getJSON("data/index.json")]);
      config = cfg;
      tracks = trk;
      trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));
      issues = (await Promise.all(index.issues.map((i) => getJSON(i.file))))
        .sort((x, y) => y.date.localeCompare(x.date));
    } catch (e) {
      $("#content").innerHTML = `<p class="empty">데이터를 불러오지 못했습니다. (${esc(e.message)})</p>`;
      return;
    }
    readHash();
    if (!state.date && issues.length) state.date = issues[0].date;
    $("#search").value = state.q;
    renderSelect();
    update();

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
    let timer;
    $("#search").addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 200);
    });
    $("#toggle-answers").addEventListener("click", () => {
      state.openAll = !state.openAll;
      document.querySelectorAll("#content details").forEach((d) => { d.open = state.openAll; });
      $("#toggle-answers").textContent = state.openAll ? "💡 예시 답안 모두 접기" : "💡 예시 답안 모두 펼치기";
    });
    $("#content").addEventListener("click", (e) => {
      const b = e.target.closest(".submit-btn");
      if (b) openSubmit(b);
    });
    $("#submit-form").addEventListener("submit", sendSubmit);
    $("#submit-form").answer.addEventListener("input", (e) => store.set(draftKey(), e.target.value));
    $("#submit-cancel").addEventListener("click", () => $("#submit-dialog").close());
    window.addEventListener("hashchange", () => { readHash(); if (!state.date) state.date = issues[0].date; $("#issue-select").value = state.date; renderChips(); render(); });
  }

  init();
})();
