/**
 * 학생 답안 제출 받기 (Google Apps Script 웹 앱)
 *
 * 답안 스프레드시트에서 [확장 프로그램 → Apps Script]를 열고 이 코드를 붙여 넣은 뒤
 * [배포 → 새 배포 → 웹 앱]으로 배포합니다. (실행: 나, 액세스 권한: 모든 사용자)
 * 배포 URL을 data/config.json 의 submitUrl 에 넣으면 사이트에 "답안 제출" 버튼이 나타납니다.
 */
const SHEET_NAME = '답안';
const MAX_ANSWER = 3000;

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    // 봇 차단용 숨은 칸이 채워져 있으면 무시
    if (d.website) return json_({ ok: true });
    const studentId = clean_(d.studentId, 20);
    const name = clean_(d.name, 20);
    const answer = clean_(d.answer, MAX_ANSWER);
    if (!studentId || !name || !answer) return json_({ ok: false, error: '학번, 이름, 답안을 모두 적어 주세요.' });
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
    ]);
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
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
