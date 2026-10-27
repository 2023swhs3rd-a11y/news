/**
 * 학생 답안 제출 받기 (Google Apps Script 웹 앱)
 *
 * 답안 스프레드시트에서 [확장 프로그램 → Apps Script]를 열고 이 코드를 붙여 넣은 뒤
 * [배포 → 새 배포 → 웹 앱]으로 배포합니다. (실행: 나, 액세스 권한: 모든 사용자)
 * 배포 URL을 data/config.json 의 submitUrl 에 넣으면 사이트에 "답안 제출" 버튼이 나타납니다.
 *
 * 코드를 고친 뒤에는 [배포 → 배포 관리 → ✏️ 수정 → 버전: 새 버전 → 배포]로 다시 배포합니다.
 * 이렇게 하면 웹 앱 URL이 그대로라 config.json 을 바꿀 필요가 없습니다.
 * '답안' 탭 열: 제출 시각, 발행일, 계열, 기사, 질문 유형, 질문, 학번, 이름, 답안, 교사 메모, 제출 번호
 */
const SHEET_NAME = '답안';
const MAX_ANSWER = 3000;
const PER_MINUTE = 10; // 한 학번이 1분에 보낼 수 있는 답안 수

// 반 전체가 동시에 제출할 때를 대비해 시트 쓰기는 한 번에 하나씩 한다.
// 잠금을 오래 기다리지 않고 busy 로 답하면 사이트가 잠시 뒤 다시 보낸다.
function doPost(e) {
  let d;
  try {
    d = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '잘못된 요청입니다.' });
  }
  // 봇 차단용 숨은 칸이 채워져 있으면 무시
  if (d.website) return json_({ ok: true });
  const studentId = clean_(d.studentId, 20);
  const name = clean_(d.name, 20);
  const answer = clean_(d.answer, MAX_ANSWER);
  if (!studentId || !name || !answer) return json_({ ok: false, error: '학번, 이름, 답안을 모두 적어 주세요.' });

  const cache = CacheService.getScriptCache();
  const sid = clean_(d.sid, 64);
  // 같은 제출(다시 보내기)이면 한 번만 저장
  if (sid && cache.get('sid:' + sid)) return json_({ ok: true, duplicate: true });
  const rateKey = 'n:' + studentId;
  const count = Number(cache.get(rateKey) || 0);
  if (count >= PER_MINUTE) return json_({ ok: false, error: '너무 빠르게 여러 번 제출했어요. 1분 뒤에 다시 제출해 주세요.' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return json_({ ok: false, busy: true, error: '제출하는 학생이 많아요. 잠시 뒤 다시 눌러 주세요.' });
  try {
    if (sid && cache.get('sid:' + sid)) return json_({ ok: true, duplicate: true });
    const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
    sheet.appendRow([
      new Date(),
      clean_(d.issueDate, 10),
      clean_(d.tracks, 50),
      clean_(d.article, 200),
      clean_(d.qtype, 10),
      clean_(d.question, 500),
      // 학번이 숫자로 바뀌지 않도록 텍스트로 저장
      "'" + studentId,
      name,
      answer,
      '', // 교사 메모
      sid,
    ]);
    SpreadsheetApp.flush();
    if (sid) cache.put('sid:' + sid, '1', 21600);
    cache.put(rateKey, String(count + 1), 60);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, busy: true, error: '저장 중 문제가 생겼어요. 잠시 뒤 다시 눌러 주세요.' });
  } finally {
    lock.releaseLock();
  }
}

function clean_(v, max) {
  // 수식으로 해석되지 않도록 =,+,-,@ 로 시작하면 앞에 작은따옴표를 붙인다
  let s = String(v == null ? '' : v).trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
