/**
 * =============================================================
 *  UNION ONE — 통신 창구
 *  파일명: 연결.gs
 * -------------------------------------------------------------
 *  이 프로젝트의 유일한 바깥 통로입니다.
 *
 *  · doGet 을 만들지 않습니다.
 *    브라우저로 배포 주소를 열어도 아무 화면이 뜨지 않습니다.
 *    구글 도메인에서 로그인 화면을 띄우지 않는 것이 목적입니다.
 *
 *  · HtmlService 를 쓰지 않습니다. 응답은 JSON 뿐입니다.
 *
 *  · 화면은 깃허브에서 띄우고, 여기로는 자료만 오갑니다.
 * =============================================================
 */

/* 바깥에서 부를 수 있는 함수 목록.
   여기에 없는 이름은 어떤 경우에도 실행되지 않습니다.
   기능을 추가할 때 api_ 함수를 만들었다면 이 목록에도 넣어주세요. */
var 허용함수 = {
  api_start: 1,
  api_boot: 1,
  api_checkPhone: 1,
  api_login: 1,
  api_changePin: 1,
  api_resetPin: 1,
  api_logout: 1,
  api_lastUpdate: 1,
  api_board: 1,
  api_saveTask: 1,
  api_deleteTask: 1,
  api_doneAll: 1,
  api_deleteLog: 1,
  api_taskDetail: 1,
  api_markRead: 1,
  api_settle: 1,
  api_addSettle: 1,
  api_deleteSettle: 1,
  api_saveLog: 1,
  api_docList: 1,
  api_docDetail: 1,
  api_docDetails: 1,
  api_saveDoc: 1,
  api_docPdf: 1,
  api_readDoc: 1,
  api_actDoc: 1,
  api_posts: 1,
  api_savePost: 1,
  api_deletePost: 1,
  api_saveComment: 1,
  api_deleteComment: 1,
  api_deleteDoc: 1,
  api_notifications: 1,
  api_readNotifications: 1,
  api_settings: 1,
  api_setDeputy: 1,
  api_saveSign: 1,
  api_saveSetting: 1,
  api_refreshMeta: 1,
  api_syncNow: 1,
  api_saveStaff: 1,

  /* 사용 신청과 승인 (가입승인.js) */
  api_signup: 1,        // 로그인 전에도 부를 수 있는 유일한 쓰기 기능
  api_approve: 1,
  api_reject: 1,
  api_setGrade: 1,
  api_setLeft: 1
};

/* 한 사람이 짧은 시간에 몇 번까지 부를 수 있는지.
   화면 하나 여는 데 서너 번 부르므로 넉넉하게 잡되,
   버튼 연타나 무한 반복 같은 사고는 여기서 끊습니다. */
var 호출제한 = {
  창초: 10,     // 몇 초 동안
  최대: 40      // 몇 번까지
};


/* =============================================================
 *  들어오는 문
 * ============================================================= */
function doPost(e) {
  var 시작 = new Date().getTime();

  /* 1. 본문 읽기 */
  var 요청 = null;
  try {
    요청 = JSON.parse(e.postData.contents);
  } catch (err) {
    return 응답_({ ok: false, code: 'BAD_BODY', message: '요청을 읽지 못했습니다.' });
  }
  if (!요청 || typeof 요청 !== 'object') {
    return 응답_({ ok: false, code: 'BAD_BODY', message: '요청을 읽지 못했습니다.' });
  }

  /* 2. 함수 이름 확인 */
  var 이름 = String(요청.fn || '');
  if (!허용함수[이름]) {
    return 응답_({ ok: false, code: 'NOT_ALLOWED', message: '허용되지 않은 요청입니다.' });
  }

  var 인자 = 요청.args;
  if (!Array.isArray(인자)) 인자 = [];
  if (인자.length > 8) {
    return 응답_({ ok: false, code: 'BAD_ARGS', message: '요청 형식이 올바르지 않습니다.' });
  }

  /* 3. 호출 제한 — 기기 또는 로그인 토큰 기준 */
  var 주체 = String(요청.key || 인자[0] || 'anon').substring(0, 64);
  if (!호출허용_(주체)) {
    return 응답_({
      ok: false,
      code: 'TOO_MANY',
      message: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'
    });
  }

  /* 4. 하루 한 번 시트 구조 점검
        예전에는 doGet 에서 하던 일입니다. 앱을 처음 열 때만 돕니다. */
  if (이름 === 'api_start' || 이름 === 'api_boot') 하루점검_();

  /* 5. 실행 */
  try {
    var 함수 = globalThis[이름];
    if (typeof 함수 !== 'function') {
      return 응답_({ ok: false, code: 'NO_FUNC', message: '기능을 찾지 못했습니다.' });
    }

    var 결과 = 함수.apply(null, 인자);
    if (결과 === null || 결과 === undefined) 결과 = { ok: true };
    if (typeof 결과 === 'object' && 결과.통신ms === undefined) {
      결과.통신ms = new Date().getTime() - 시작;
    }
    return 응답_(결과);

  } catch (err) {
    /* 실패를 조용히 넘기지 않습니다.
       앱이 자동으로 다시 시도하면 호출이 폭증하기 때문입니다. */
    try { log_('오류', 이름 + ' : ' + (err && err.message ? err.message : err)); } catch (e2) {}
    return 응답_({
      ok: false,
      code: 'SERVER_ERROR',
      message: '처리 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.'
    });
  }
}


/* =============================================================
 *  도우미
 * ============================================================= */

/** JSON 으로만 내보냅니다. HTML 은 어떤 경우에도 내보내지 않습니다. */
function 응답_(값) {
  return ContentService
    .createTextOutput(JSON.stringify(값))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 짧은 시간 안에 너무 많이 부르는지 확인 */
function 호출허용_(주체) {
  try {
    var cache = CacheService.getScriptCache();
    var 키 = 'rl_' + 주체;
    var 현재 = Number(cache.get(키) || 0) + 1;
    cache.put(키, String(현재), 호출제한.창초);
    return 현재 <= 호출제한.최대;
  } catch (e) {
    return true;   // 캐시가 막히면 막지 않습니다. 서비스가 멈추면 안 되니까요
  }
}

/** 하루 한 번만 시트 구조를 점검합니다 */
function 하루점검_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var 표시 = props.getProperty('SETUP_DAY');
    var 오늘 = today_() + '|' + SETUP_VER;
    if (표시 === 오늘) return;
    if (점검_지금하기() === '점검 완료') props.setProperty('SETUP_DAY', 오늘);
  } catch (e) {}
}


/* =============================================================
 *  연결 확인 — 편집기에서 직접 실행해 보는 용도
 *  배포가 살아있는지, 시트가 붙어 있는지 확인합니다
 * ============================================================= */
function 연결확인() {
  var 줄 = [];

  try {
    var ss = ss_();
    줄.push('스프레드시트  →  ' + ss.getName());
    줄.push('시트 ID       →  ' + ss.getId());
  } catch (e) {
    줄.push('스프레드시트  →  실패. 스크립트에 시트가 연결되지 않았습니다');
  }

  줄.push('코드 버전     →  ' + SETUP_VER);
  줄.push('허용 함수     →  ' + Object.keys(허용함수).length + '개');
  줄.push('doGet         →  없음 (정상)');

  var 결과 = 줄.join('\n');
  Logger.log(결과);
  return 결과;
}
