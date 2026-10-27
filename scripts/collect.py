#!/usr/bin/env python3
"""data/sources.json 의 매체에서 지난 한 주 헤드라인을 모아 data/raw/<발행일>.json 으로 저장한다.

GitHub Actions(매주 일요일)에서 실행한다. 표준 라이브러리만 쓰며, 실패한 매체는 errors 에 남기고 건너뛴다.

  python scripts/collect.py                 # 다음 월요일(오늘이 월요일이면 오늘) 호의 원자료 수집
  python scripts/collect.py --date 2026-11-02 --days 8
"""
import argparse
import html
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "Mozilla/5.0 (compatible; weekly-news-collector/1.0; +https://github.com/2023swhs3rd-a11y/news)"
PER_SOURCE = 25
TAG_RE = re.compile(r"<[^>]+>")
# XML이 모르는 HTML 엔터티(&nbsp; 등). 일부 피드(Brookings)가 그대로 넣어 파싱이 깨진다.
HTML_ENTITY_RE = re.compile(r"&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)([A-Za-z][A-Za-z0-9]*);")


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def clean(text, limit=200):
    text = html.unescape(TAG_RE.sub(" ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def parse_date(s):
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            d = datetime.fromisoformat(s.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_feed(raw):
    """RSS 2.0 과 Atom 모두 처리해 (title, url, published, summary) 목록을 돌려준다."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        text = raw.decode("utf-8", "replace")
        text = HTML_ENTITY_RE.sub(lambda m: f"&#{ord(html.unescape(m.group(0)))};" if len(html.unescape(m.group(0))) == 1 else "", text)
        try:
            root = ET.fromstring(text.encode("utf-8"))
        except ET.ParseError:
            return parse_feed_loose(text)
    out = []
    for el in root.iter():
        if local(el.tag) not in ("item", "entry"):
            continue
        f = {}
        for c in el:
            name = local(c.tag)
            if name == "link":
                f.setdefault("link", c.get("href") or (c.text or "").strip())
            elif name in ("title", "pubDate", "published", "updated", "date", "description", "summary"):
                f.setdefault(name, c.text or "")
            elif name == "source":
                f.setdefault("source", c.text or "")
        published = parse_date(f.get("pubDate") or f.get("published") or f.get("updated") or f.get("date"))
        out.append({
            "title": clean(f.get("title"), 200),
            "url": f.get("link", ""),
            "published": published.isoformat() if published else None,
            "summary": clean(f.get("description") or f.get("summary")),
            "_outlet": f.get("source", ""),
        })
    return out


def parse_feed_loose(text):
    """XML 형식이 깨진 RSS 를 위한 정규식 파서. <item> 의 제목·링크·날짜·설명만 뽑는다."""
    def field(block, name):
        m = re.search(rf"<{name}[^>]*>(.*?)</{name}>", block, re.S)
        if not m:
            return ""
        v = m.group(1).strip()
        return v[9:-3] if v.startswith("<![CDATA[") and v.endswith("]]>") else v
    out = []
    for block in re.findall(r"<item[\s>].*?</item>", text, re.S):
        published = parse_date(html.unescape(field(block, "pubDate")))
        out.append({
            "title": clean(field(block, "title"), 200),
            "url": html.unescape(field(block, "link")),
            "published": published.isoformat() if published else None,
            "summary": clean(field(block, "description")),
            "_outlet": "",
        })
    return out


def gnews_url(src):
    q = urllib.parse.quote(f"{src['query']} when:7d")
    if src.get("hl") == "en":
        return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    return f"https://news.google.com/rss/search?q={q}&hl=ko&gl=KR&ceid=KR:ko"


def collect_kdi(url):
    page = fetch(url).decode("utf-8", "replace")
    items, seen = [], set()
    for m in re.finditer(r'href="([^"]*reportView\?pub_no=(\d+))"[^>]*>(.*?)</a>', page, re.S):
        pub = m.group(2)
        title = clean(m.group(3), 200)
        if pub in seen or not title:
            continue
        seen.add(pub)
        items.append({"title": title, "url": f"https://www.kdi.re.kr/research/reportView?pub_no={pub}",
                      "published": None, "summary": ""})
    return items


def monday_on_or_after(d):
    return d + timedelta(days=(7 - d.weekday()) % 7)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="발행일(YYYY-MM-DD). 기본값: 다음 월요일")
    ap.add_argument("--days", type=int, default=8, help="발행일 전 며칠치 기사를 모을지")
    args = ap.parse_args()

    issue_date = date.fromisoformat(args.date) if args.date else monday_on_or_after(datetime.now(timezone(timedelta(hours=9))).date())
    since = datetime.combine(issue_date - timedelta(days=args.days), datetime.min.time(), timezone.utc)
    sources = json.loads((ROOT / "data" / "sources.json").read_text(encoding="utf-8"))["sources"]

    result = {"issue_date": issue_date.isoformat(), "collected_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "since": since.date().isoformat(), "items": [], "errors": []}
    for src in sources:
        urls = [gnews_url(src)] if src["type"] == "gnews" else src.get("urls", [])
        got = []
        for url in urls:
            try:
                got += collect_kdi(url) if src["type"] == "kdi" else parse_feed(fetch(url))
            except Exception as e:  # 매체 하나가 실패해도 나머지는 계속 모은다
                result["errors"].append({"source": src["name"], "url": url, "error": f"{type(e).__name__}: {e}"[:200]})
        seen, kept = set(), []
        for it in got:
            if not it["url"] or it["url"] in seen:
                continue
            if it["published"] and datetime.fromisoformat(it["published"]) < since:
                continue
            seen.add(it["url"])
            if src["type"] == "gnews":
                # 구글 뉴스 제목은 "제목 - 매체명" 형식
                it["title"] = re.sub(r"\s+-\s+[^-]+$", "", it["title"])
            it.pop("_outlet", None)
            kept.append({"source": src["name"], "kind": src["kind"], "lang": src["lang"], **({"paywall": True} if src.get("paywall") else {}), **it})
        kept.sort(key=lambda x: x["published"] or "", reverse=True)
        result["items"] += kept[:PER_SOURCE]
        print(f"{src['name']}: {len(kept[:PER_SOURCE])}건", file=sys.stderr)

    out = ROOT / "data" / "raw" / f"{issue_date.isoformat()}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out.relative_to(ROOT)}: {len(result['items'])}건, 실패 {len(result['errors'])}건", file=sys.stderr)


if __name__ == "__main__":
    main()
