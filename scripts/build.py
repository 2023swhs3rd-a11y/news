#!/usr/bin/env python3
"""발행된 호(data/issues/*.json)를 검사하고 GitHub Pages용 _site/ 를 만든다.

  python scripts/build.py            # 검사 + _site/ 생성 (index.json, feed.xml, feeds/*.xml 포함)
  python scripts/build.py --check    # 검사만

검사에 실패하면 종료 코드 1. 과목명이 data/curriculum.json 에 없으면 경고만 한다.
"""
import argparse
import html
import json
import os
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "_site"
SITE_URL = os.environ.get("SITE_URL", "https://2023swhs3rd-a11y.github.io/news/").rstrip("/") + "/"
QTYPES = ["알아보기", "연결하기", "확장하기", "비교하기"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SITE_TITLE = "봉일천고 1학년 뉴스 읽고 진로 확장하기"
MIN_ANSWER = 250  # 예시 답안 최소 글자 수


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def known_subjects():
    cur = load(DATA / "curriculum.json")
    names = set()
    for key, groups in cur.items():
        if key.startswith("_"):
            continue
        for subjects in groups.values():
            names.update(subjects)
    return names


def check_link(errors, where, link, title_key):
    url = link.get("url", "")
    if not url.startswith("https://") and not url.startswith("http://"):
        errors.append(f"{where}: url 이 http(s) 주소가 아님 ({url!r})")
    for k in (title_key, "source"):
        if not link.get(k):
            errors.append(f"{where}: '{k}' 없음")


def validate(path, track_ids, subjects):
    errors, warnings = [], []
    name = path.name
    try:
        issue = load(path)
    except json.JSONDecodeError as e:
        return None, [f"{name}: JSON 형식 오류 ({e})"], []

    date = issue.get("date", "")
    if not DATE_RE.match(date) or path.stem != date:
        errors.append(f"{name}: date({date!r})가 파일명과 같은 YYYY-MM-DD 여야 함")
    for k in ("title", "period", "intro"):
        if not issue.get(k):
            errors.append(f"{name}: '{k}' 없음")
    for i, h in enumerate(issue.get("headlines", [])):
        check_link(errors, f"{name} headlines[{i}]", h, "title")

    articles = issue.get("articles", [])
    if not articles:
        errors.append(f"{name}: articles 가 비어 있음")
    seen_ids, covered = set(), set()
    for i, a in enumerate(articles):
        w = f"{name} articles[{i}] ({a.get('id', '?')})"
        if not a.get("id") or a["id"] in seen_ids:
            errors.append(f"{w}: id 가 없거나 중복")
        seen_ids.add(a.get("id"))
        for k in ("title", "summary"):
            if not a.get(k):
                errors.append(f"{w}: '{k}' 없음")
        ts = a.get("tracks", [])
        if not ts:
            errors.append(f"{w}: tracks 없음")
        for t in ts:
            if t not in track_ids:
                errors.append(f"{w}: 알 수 없는 계열 '{t}'")
        covered.update(ts)
        if not a.get("links"):
            errors.append(f"{w}: links 없음")
        for j, l in enumerate(a.get("links", [])):
            check_link(errors, f"{w} links[{j}]", l, "label")
        if not a.get("curriculum"):
            errors.append(f"{w}: curriculum 없음")
        for c in a.get("curriculum", []):
            if c.get("subject") not in subjects:
                warnings.append(f"{w}: 과목명 '{c.get('subject')}' 이 2022 개정 과목 목록에 없음")
        types = [q.get("type") for q in a.get("questions", [])]
        if sorted(types, key=lambda t: QTYPES.index(t) if t in QTYPES else 99) != QTYPES:
            errors.append(f"{w}: 질문은 {'/'.join(QTYPES)} 각 1개씩이어야 함 (현재 {types})")
        for q in a.get("questions", []):
            if not q.get("q") or not q.get("a"):
                errors.append(f"{w}: '{q.get('type')}' 질문 또는 예시 답안(a)이 비어 있음")
            elif len(q["a"]) < MIN_ANSWER:
                errors.append(f"{w}: '{q.get('type')}' 예시 답안이 {len(q['a'])}자로 짧음 ({MIN_ANSWER}자 이상)")
            for c in q.get("concepts", []):
                if not c.get("term") or not c.get("desc"):
                    errors.append(f"{w}: '{q.get('type')}' 개념 해설에 term/desc 가 비어 있음")

    missing = sorted(track_ids - covered)
    if missing:
        warnings.append(f"{name}: 다루지 않은 계열 {missing}")
    for i, r in enumerate(issue.get("reading", [])):
        check_link(errors, f"{name} reading[{i}]", r, "title")
    return issue, errors, warnings


def rfc822(date):
    # 발행일 아침 7시(KST)
    d = datetime.strptime(date, "%Y-%m-%d").replace(hour=7, tzinfo=timezone(timedelta(hours=9)))
    return format_datetime(d)


def rss(title, link, desc, items):
    now = format_datetime(datetime.now(timezone.utc))
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "<channel>",
        f"<title>{escape(title)}</title>",
        f"<link>{escape(link)}</link>",
        f"<description>{escape(desc)}</description>",
        "<language>ko</language>",
        f"<lastBuildDate>{now}</lastBuildDate>",
    ]
    for it in items:
        parts += [
            "<item>",
            f"<title>{escape(it['title'])}</title>",
            f"<link>{escape(it['link'])}</link>",
            f'<guid isPermaLink="false">{escape(it["guid"])}</guid>',
            f"<pubDate>{it['pubDate']}</pubDate>",
            f"<description>{escape(it['html'])}</description>",
            "</item>",
        ]
    parts += ["</channel>", "</rss>", ""]
    return "\n".join(parts)


def article_html(a):
    e = html.escape
    links = "".join(f'<li><a href="{e(l["url"])}">{e(l["label"])}</a> · {e(l["source"])}</li>' for l in a["links"])
    curr = "".join(f"<li>{e(c['subject'])}{(' › ' + e(c['unit'])) if c.get('unit') else ''}: {e(', '.join(c.get('concepts', [])))}</li>" for c in a["curriculum"])
    qs = "".join(f"<li><b>{e(q['type'])}</b> {e(q['q'])}</li>" for q in a["questions"])
    return f"<h3>{e(a['title'])}</h3><p>{e(a['summary'])}</p><ul>{links}</ul><p>교과 연결</p><ul>{curr}</ul><ol>{qs}</ol>"


def build(issues, tracks):
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "data" / "issues").mkdir(parents=True)
    (OUT / "feeds").mkdir()
    shutil.copy(ROOT / "index.html", OUT / "index.html")
    shutil.copytree(ROOT / "assets", OUT / "assets")
    shutil.copy(DATA / "tracks.json", OUT / "data" / "tracks.json")
    (OUT / ".nojekyll").write_text("")

    # 호수: 가장 오래된 호가 제1호
    numbers = {iss["date"]: n for n, iss in enumerate(sorted(issues, key=lambda i: i["date"]), start=1)}
    config = load(DATA / "config.json")
    config["buildDate"] = datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d")
    (OUT / "data" / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=1), encoding="utf-8")

    index = {"issues": []}
    for iss in issues:
        shutil.copy(DATA / "issues" / f"{iss['date']}.json", OUT / "data" / "issues" / f"{iss['date']}.json")
        index["issues"].append({"date": iss["date"], "no": numbers[iss["date"]], "title": iss["title"], "period": iss.get("period", ""),
                                "file": f"data/issues/{iss['date']}.json",
                                "tracks": sorted({t for a in iss["articles"] for t in a["tracks"]})})
    (OUT / "data" / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    items = []
    for iss in issues[:30]:
        body = f"<p>{html.escape(iss['intro'])}</p>" + "".join(article_html(a) for a in iss["articles"])
        items.append({"title": f"[제{numbers[iss['date']]}호] {iss['title']}", "link": f"{SITE_URL}#date={iss['date']}",
                      "guid": f"issue-{iss['date']}", "pubDate": rfc822(iss["date"]), "html": body})
    (OUT / "feed.xml").write_text(rss(SITE_TITLE, SITE_URL, "이번 주 뉴스를 계열별로 읽고 교과 개념으로 진로를 넓혀 보는 주간 뉴스", items), encoding="utf-8")

    for t in tracks:
        items = []
        for iss in issues[:30]:
            for a in iss["articles"]:
                if t["id"] in a["tracks"]:
                    items.append({"title": a["title"], "link": f"{SITE_URL}#date={iss['date']}&track={t['id']}",
                                  "guid": f"{iss['date']}-{a['id']}", "pubDate": rfc822(iss["date"]), "html": article_html(a)})
        (OUT / "feeds" / f"{t['id']}.xml").write_text(
            rss(f"{SITE_TITLE} · {t['name']}", f"{SITE_URL}#track={t['id']}", t["desc"], items), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="검사만 하고 _site 를 만들지 않음")
    args = ap.parse_args()

    tracks = load(DATA / "tracks.json")
    track_ids = {t["id"] for t in tracks}
    subjects = known_subjects()
    issues, all_errors = [], []
    for path in sorted((DATA / "issues").glob("*.json")):
        issue, errors, warnings = validate(path, track_ids, subjects)
        for w in warnings:
            print("경고:", w)
        all_errors += errors
        if issue and not errors:
            issues.append(issue)
    for e in all_errors:
        print("오류:", e)
    if all_errors:
        print(f"\n검사 실패: 오류 {len(all_errors)}건")
        sys.exit(1)
    issues.sort(key=lambda i: i["date"], reverse=True)
    print(f"검사 통과: {len(issues)}개 호")
    if not args.check:
        build(issues, tracks)
        print(f"_site/ 생성 완료 ({SITE_URL})")


if __name__ == "__main__":
    main()
