# 주간 계열 탐구 뉴스

일반계 고등학생을 위한 계열별 주간 뉴스 사이트입니다. 매주 월요일 아침 발간됩니다.

- 사이트: https://2023swhs3rd-a11y.github.io/news/
- RSS(전체): https://2023swhs3rd-a11y.github.io/news/feed.xml
- RSS(계열별): `feeds/hum.xml`(인문·사회), `biz`(경영·경제), `sci`(자연과학), `eng`(공학), `med`(의약·보건), `edu`(교육), `art`(예체능), `common`(공통)

## 선생님 검토 방법 (매주 월요일 아침)

1. 일요일 밤에 열린 `[원고] ... 호` PR을 엽니다.
2. **Files changed**에서 기사 링크, 요약, 질문, 예시 답안을 확인합니다.
   - 직접 고치려면 파일 오른쪽 `...` → **Edit file**로 수정 후 커밋합니다.
   - 고칠 점을 PR 댓글로 남기면 Claude가 반영합니다.
3. 괜찮으면 **Merge pull request**를 누릅니다. 1~2분 뒤 사이트와 RSS에 게시됩니다.

## 처음 한 번 설정

- **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 바꿉니다.

자세한 편집 기준과 구조는 [CLAUDE.md](CLAUDE.md)에 있습니다.
