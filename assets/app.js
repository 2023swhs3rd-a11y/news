// 주간 계열 탐구 뉴스: 정적 데이터(data/index.json, data/issues/*.json)를 읽어 필터링해 보여준다.
(function () {
  "use strict";

  const QTYPES = ["알아보기", "연결하기", "확장하기", "비교하기"];
  const state = { date: null, tracks: new Set(), q: "", openAll: false };
  let tracks = [];
  let trackById = {};
  let issues = [];

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

  function matchesTracks(itemTracks) {
    if (!state.tracks.size) return true;
    return (itemTracks || []).some((t) => state.tracks.has(t));
  }

  function matchesQuery(a) {
    if (!state.q) return true;
    const q = state.q.toLowerCase();
    const hay = [a.title, a.summary,
      ...(a.curriculum || []).flatMap((c) => [c.subject, c.unit, ...(c.concepts || [])]),
      ...(a.questions || []).map((x) => x.q),
      ...(a.links || []).map((l) => l.label + " " + l.source)].join(" ").toLowerCase();
    return hay.includes(q);
  }

  function renderChips() {
    const box = $("#track-chips");
    const all = `<button type="button" class="chip" data-track="" aria-pressed="${!state.tracks.size}">전체</button>`;
    box.innerHTML = all + tracks.map((t) =>
      `<button type="button" class="chip" data-track="${t.id}" aria-pressed="${state.tracks.has(t.id)}" title="${esc(t.desc)}">${t.emoji} ${esc(t.name)}</button>`
    ).join("");
  }

  function renderSelect() {
    const sel = $("#issue-select");
    sel.innerHTML = `<option value="all">모든 호 보기</option>` + issues.map((i) =>
      `<option value="${i.date}">${fmtDate(i.date)} · ${esc(i.title)}</option>`).join("");
    sel.value = state.date || "all";
  }

  function articleHTML(a, date, showDate) {
    const badges = (a.tracks || []).map((t) => trackById[t] ? `<span class="badge">${trackById[t].emoji} ${esc(trackById[t].name)}</span>` : "").join("");
    const dateBadge = showDate ? `<a class="badge date" href="#date=${date}">${fmtDate(date)} 호</a>` : "";
    const links = (a.links || []).map((l) =>
      `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a> <span class="muted">· ${esc(l.source)}</span>${l.lang === "en" ? '<span class="lang">EN</span>' : ""}</li>`).join("");
    const curr = (a.curriculum || []).map((c) =>
      `<div><b>${esc(c.subject)}</b>${c.unit ? ` <span class="muted">› ${esc(c.unit)}</span>` : ""}${c.concepts && c.concepts.length ? ` : ${c.concepts.map(esc).join(", ")}` : ""}</div>`).join("");
    const qs = (a.questions || []).slice().sort((x, y) => QTYPES.indexOf(x.type) - QTYPES.indexOf(y.type)).map((x) => `
      <li>
        <span class="qtype">${esc(x.type)}</span> ${esc(x.q)}
        ${x.a ? `<details${state.openAll ? " open" : ""}><summary>예시 답안 보기</summary><div class="answer">${esc(x.a)}</div></details>` : ""}
      </li>`).join("");
    return `
      <article class="card" id="${esc(a.id)}">
        <div class="badges">${dateBadge}${badges}</div>
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.summary)}</p>
        <ul class="links">${links}</ul>
        <div class="curr" aria-label="교과 연결">${curr}</div>
        <ol class="questions">${qs}</ol>
      </article>`;
  }

  function readingHTML(list) {
    if (!list.length) return "";
    return `<section class="reading"><h3>📚 더 읽을거리 (싱크탱크·보고서)</h3><ul class="links">${list.map((r) =>
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
          <div class="date">${fmtDate(issue.date)} 발행 · 다룬 기간 ${esc(issue.period || "")}</div>
          <h2>${esc(issue.title)}</h2>
          <p>${esc(issue.intro || "")}</p>
        </section>
        ${!filtered && issue.headlines && issue.headlines.length ? `<section class="headlines"><h3>이번 주 헤드라인</h3><ul>${issue.headlines.map((h) =>
          `<li><a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a> <span class="muted">· ${esc(h.source)}</span>${h.lang === "en" ? '<span class="lang">EN</span>' : ""}</li>`).join("")}</ul></section>` : ""}
        ${arts.length ? arts.map((a) => articleHTML(a, issue.date, false)).join("") : `<p class="empty">조건에 맞는 기사가 없습니다.</p>`}
        ${readingHTML(reading)}`;
    } else {
      const rows = issues.flatMap((i) => i.articles.map((a) => ({ a, date: i.date })))
        .filter(({ a }) => matchesTracks(a.tracks) && matchesQuery(a));
      main.innerHTML = `<section class="issue-head"><h2>모든 호</h2><p class="muted">${issues.length}개 호에서 ${rows.length}개 기사</p></section>` +
        (rows.length ? rows.map(({ a, date }) => articleHTML(a, date, true)).join("") : `<p class="empty">조건에 맞는 기사가 없습니다.</p>`);
    }
    $("#toggle-answers").textContent = state.openAll ? "예시 답안 모두 접기" : "예시 답안 모두 펼치기";
  }

  function update() { writeHash(); renderChips(); render(); }

  async function init() {
    try {
      tracks = await getJSON("data/tracks.json");
      trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));
      const index = await getJSON("data/index.json");
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
      $("#toggle-answers").textContent = state.openAll ? "예시 답안 모두 접기" : "예시 답안 모두 펼치기";
    });
    window.addEventListener("hashchange", () => { readHash(); if (!state.date) state.date = issues[0].date; $("#issue-select").value = state.date; renderChips(); render(); });
  }

  init();
})();
