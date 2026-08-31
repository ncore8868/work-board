/**
 * =============================================================
 *  UNION ONE 워크보드 - 서버 코드
 *  파일명: 코드.gs
 * =============================================================
 *  이 파일은 통째로 덮어쓰기만 하면 됩니다. 고칠 곳 없습니다.
 * =============================================================
 */

var TZ = 'Asia/Seoul';
var _SS = null;   // 스프레드시트 캐시 (직접 입력할 필요 없음)
var SALT = 'ncore-workboard-2026';  // PIN 암호화용 (변경하면 기존 PIN이 전부 무효가 됩니다)

/** 설정 시트에 없으면 자동으로 만들어 두는 항목 */
var DEFAULT_SETTINGS = [
  ['LAST_UPDATE', '', '데이터가 마지막으로 바뀐 시각 (앱이 자동 기록)'],
  ['회사명', 'UNION-ONE', '화면 상단 표시'],
  ['타임존', 'Asia/Seoul', '변경 금지'],
  ['게스트유효일수', 30, '게스트 링크 유효 일수'],
  ['앱버전', 'v1.0', '배포 버전'],
  ['출퇴근시트ID', '', '출퇴근 관리 스프레드시트 ID (설정 화면에서 입력)'],
  ['출퇴근시트명', '출퇴근', '출퇴근 기록이 들어있는 시트 이름'],
  ['견적시트ID', '', '현장견적 스프레드시트 ID (설정 화면에서 입력)'],
  ['첨부폴더ID', '', '영수증·사진이 저장되는 드라이브 폴더 (자동 생성)'],
  ['폰트URL_제목', '', '에이투지체 Bold woff2 주소 (비우면 기본 폰트)'],
  ['폰트URL_숫자', '', '에이투지체 Medium woff2 주소 (비우면 제목용과 동일)']
];

// =============================================================
//  진입점
// =============================================================
//
//  ★★ 이 파일에는 doGet 이 없습니다. 만들지 마세요 (v54에서 지웠습니다).
//
//  2026-08-27 구글 계정 정지의 원인으로 지목된 것이 바로 이 조합이었습니다.
//      HtmlService 로 PIN 로그인 화면을 구글 도메인에 띄우고
//      setXFrameOptionsMode(ALLOWALL) 로 바깥 사이트가 iframe 으로 감싸게 둔 것.
//  자동 탐지 입장에서 피싱 페이지와 구분되지 않습니다.
//
//  그런데 그 doGet 이 코드에 그대로 남아 있었습니다 (2026-08-30 점검에서 발견).
//  화면 파일이 없어 오류가 나긴 했지만, 오류가 나기 전에 시트 점검이 먼저 돌았고
//  웹앱이 ANYONE_ANONYMOUS 라 인터넷의 누구나 그것을 돌릴 수 있었습니다.
//
//  · 바깥 통로는 연결.js 의 doPost 하나뿐입니다.
//  · 하루 1회 시트 점검은 연결.js 의 하루점검_() 이 맡습니다
//    (api_start · api_boot 를 부를 때 돕니다). 여기서 할 일이 아닙니다.
//  · 브라우저로 배포 주소를 열면 아무것도 나오지 않는 것이 정상입니다.
// =============================================================

/**
 * 시트 구조 점검 (하루 1번 자동 실행 / 편집기에서 직접 실행 가능)
 *
 * 두 사람이 같은 순간에 앱을 열면 점검이 나란히 돌아서
 * 같은 양식이 두 줄 만들어진다(구매요청서가 2개로 보이던 원인).
 * 한 번에 한 사람만 들어오도록 잠근다.
 */
function 점검_지금하기() {
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (e) { lock = null; }
  if (lock) {
    /* ★ 오래 기다리지 않는다 (v43).
       이 함수는 doGet 안에서 도는데, 20초를 기다리는 동안 사용자는 흰 화면을 본다.
       다른 사람이 이미 점검 중이면 그 사람이 끝내줄 것이므로 넘어가면 된다.
       SETUP_DAY 표시를 남기지 않으므로 다음 접속 때 다시 시도한다. */
    var got = false;
    try { got = lock.tryLock(3000); } catch (e2) { got = false; }
    if (!got) return '다른 점검이 진행 중이라 건너뛰었습니다.';   // 조용히 종료
  }

  /* ★ 이미 우리가 잠금을 잡았다고 알려둔다 (v54).
     점검은 잠금을 쥔 채로 시트에 여러 줄을 씁니다. 그 안쪽 쓰기가 또 잠그려 하면
     **자기 자신을 기다리다 멈춥니다.** 이 표시가 그것을 막습니다. */
  if (lock) markInLock_(true);

  try {
    // 잠그기 전에 읽어둔 값은 낡았을 수 있다. 캐시를 버리고 지금 상태를 다시 읽는다.
    _VALS = {}; _HEAD = {}; _OBJ = {};

    ensureSettings_();
    cleanupSettings_();
    ensureColumn_('직원', 'PIN해시');
    ensureColumn_('직원', '대리인전화');
    ensureColumn_('업무', '내용');
    ensureColumn_('업무', '등록일시');   // 업무 상세에 '작성 2026-08-26 09:12' 로 보여준다
    ensureColumn_('결재문서', '도장링크');
    ensureColumn_('결재선', '처리자전화');
    ensureSignSheet_();
    ensureSyncSheet_();
    ensureLeaveSheet_();
    ensureCalendarSheets_();
    ensureReadSheet_();
    ensurePostSheets_(true);
    ensureFormSheets_();
    ensureFormItems_();
    ensureDefaultLine_();
    ensureTaskTypes_();
    bumpMeta_();
    /* ★ 여기서 bumpAllSheets_() 를 부르지 않는다 (v43).
       예전에는 아무것도 안 바뀐 날에도 캐시를 전부 버려서,
       하루 첫 접속자가 점검 + 차가운 board 를 둘 다 뒤집어썼다.
       실제로 뭔가 쓰면 그 쓰기가 dropObj_ → bumpSheet_ 로 **그 시트만** 이미 무효로 만든다.
       시트를 새로 만드는 경우는 애초에 캐시에 담긴 적이 없으므로 버릴 것도 없다
       (values_ 는 시트가 없으면 캐시에 담지 않는다). */
  } finally {
    markInLock_(false);
    if (lock) { try { lock.releaseLock(); } catch (e3) {} }
  }
  return '점검 완료';
}

/**
 * 업무유형 정리 (v44) — 총무는 그만 쓰고, 시스템을 추가한다.
 *
 * ★ 시트 줄을 지우지 않는다. 사용여부만 'N' 으로 바꾼다.
 *   이미 총무로 등록된 업무가 있고, 그 업무도 이름이 제대로 보여야 하기 때문이다
 *   (meta 의 typeAll 이 사용 안 하는 유형의 이름까지 들고 있다).
 * 바뀐 것이 없으면 시트에 아무것도 쓰지 않는다.
 */
function ensureTaskTypes_() {
  var sh = sheet_('업무유형');
  if (!sh) return;

  var have = {};
  readObjects_('업무유형').forEach(function (r) {
    var code = String(r['유형코드'] || '').trim();
    if (code) have[code] = r;
  });

  if (have['GA'] && String(have['GA']['사용여부'] || '') !== 'N') {
    updateObject_('업무유형', have['GA']._row, { '사용여부': 'N' });
  }
  if (!have['SYS']) {
    appendObject_('업무유형', {
      '유형코드': 'SYS', '유형명': '시스템', '추가양식': '', '사용여부': 'Y'
    });
  }
}

/** 휴가 기록 시트 (휴가 신청서가 최종 승인되면 여기에 한 줄씩 쌓인다) */
function ensureLeaveSheet_() {
  var ss = ss_();
  if (ss.getSheetByName('휴가')) return;
  var sh = ss.insertSheet('휴가');
  sh.getRange(1, 1, 1, 9).setValues([['휴가ID', '전화번호', '이름', '휴가종류',
    '시작일', '종료일', '일수', '문서번호', '승인일시']])
    .setFontWeight('bold').setBackground('#F1F3F4');
  sh.setFrozenRows(1);
  sh.getRange('B2:B').setNumberFormat('@');    // 전화번호 앞자리 0이 사라지지 않게
  sh.getRange('E2:F').setNumberFormat('@');
  delete _VALS['휴가']; delete _OBJ['휴가'];
  delete _HEAD['휴가'];
}

/**
 * 일정 · 일정구분 시트 (회사 일정표 — v47)
 *
 * '휴가' 와 섞지 않는다. 휴가는 휴가 신청서가 결재로 승인될 때 서버가 자동으로
 * 쌓는 것이고, 일정은 사람이 달력에서 직접 넣는 것이라 성격이 다르다.
 *
 * ★ 시트가 없으면 **실제로 만든다.** ensureSettings_ 처럼 '없으면 조용히 넘어가기'
 *   로 두면 달력이 영영 비어 있고 왜 그런지 찾기 어렵다.
 * ★ 날짜·시각·전화번호 열은 글자(@)로 굳힌다.
 *   시트가 날짜로 바꿔 담으면 시차 때문에 하루가 밀리고,
 *   전화번호는 앞자리 0 이 떨어져 사람을 못 찾는다.
 */
var EVENT_HEAD = ['일정ID', '시작일', '종료일', '시각', '구분', '대상자전화',
                  '제목', '내용', '등록자전화', '등록일시', '수정일시'];
var EVENT_KIND_HEAD = ['구분코드', '구분명', '표시순서', '사용여부'];
var EVENT_KIND_SEED = [
  ['VISIT', '현장방문', 1, 'Y'],
  ['MEET', '미팅', 2, 'Y'],
  ['PERSONAL', '개인일정', 3, 'Y']
];

function ensureCalendarSheets_() {
  var ss = ss_();

  if (!ss.getSheetByName('일정')) {
    var sh = ss.insertSheet('일정');
    sh.getRange(1, 1, 1, EVENT_HEAD.length).setValues([EVENT_HEAD])
      .setFontWeight('bold').setBackground('#F1F3F4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(7, 240); sh.setColumnWidth(8, 320);
    sh.getRange('B2:D').setNumberFormat('@');    // 시작일 · 종료일 · 시각
    sh.getRange('F2:F').setNumberFormat('@');    // 대상자전화
    sh.getRange('I2:I').setNumberFormat('@');    // 등록자전화
    delete _VALS['일정']; delete _OBJ['일정']; delete _HEAD['일정'];
  } else {
    EVENT_HEAD.forEach(function (c) { ensureColumn_('일정', c); });
  }

  if (!ss.getSheetByName('일정구분')) {
    var sh2 = ss.insertSheet('일정구분');
    sh2.getRange(1, 1, 1, EVENT_KIND_HEAD.length).setValues([EVENT_KIND_HEAD])
      .setFontWeight('bold').setBackground('#F1F3F4');
    sh2.setFrozenRows(1);
    sh2.getRange(2, 1, EVENT_KIND_SEED.length, EVENT_KIND_HEAD.length)
       .setValues(EVENT_KIND_SEED);
    delete _VALS['일정구분']; delete _OBJ['일정구분']; delete _HEAD['일정구분'];
  } else {
    EVENT_KIND_HEAD.forEach(function (c) { ensureColumn_('일정구분', c); });
    /* 기본 세 줄이 통째로 지워졌으면 되살린다. 있으면 아무것도 쓰지 않는다.
       ★ 줄을 지우지 않는다 — 이미 그 구분으로 등록된 일정이 이름을 잃는다.
         그만 쓰려면 사용여부만 'N' 으로 (업무유형과 같은 방식). */
    var have = {};
    readObjects_('일정구분').forEach(function (r) {
      if (r['구분코드']) have[String(r['구분코드'])] = 1;
    });
    EVENT_KIND_SEED.forEach(function (s) {
      if (have[s[0]]) return;
      appendObject_('일정구분', {
        '구분코드': s[0], '구분명': s[1], '표시순서': s[2], '사용여부': s[3]
      });
    });
  }
}

/** 편집기에서 직접 실행 — 달력 시트를 지금 만든다 (하루 1회 점검을 기다리지 않고) */
function 달력시트_만들기() {
  _VALS = {}; _HEAD = {}; _OBJ = {};
  ensureCalendarSheets_();

  var ss = ss_();
  var 줄 = [];
  줄.push('일정 시트      →  ' + (ss.getSheetByName('일정') ? '있음' : '없음'));
  줄.push('일정구분 시트  →  ' + (ss.getSheetByName('일정구분') ? '있음' : '없음'));
  readObjects_('일정구분').forEach(function (r) {
    줄.push('   ' + r['구분코드'] + '  ' + r['구분명'] +
            '  (표시순서 ' + (r['표시순서'] || '') + ' · 사용 ' + (r['사용여부'] || 'Y') + ')');
  });
  줄.push('등록된 일정    →  ' + readObjects_('일정').length + '건');

  var 결과 = 줄.join('\n');
  Logger.log(결과);
  return 결과;
}

/**
 * 결재 양식이 받을 입력칸 — 코드가 정답을 들고 있고 시트를 여기에 맞춘다.
 * 여기 없는 양식코드(ADD 등)는 손대지 않는다.
 * 이미 올라간 결재문서의 '문서상세' 값은 건드리지 않는다. 양식 정의만 정리한다.
 */
var PAY_OPTS = '법인카드,개인카드,계좌이체,현금';
var FORM_ITEMS = {
  EXP: [
    { name: '결제수단', kind: '선택', req: 'Y', opts: PAY_OPTS, help: '' }
  ],
  PUR: [
    { name: '결제수단', kind: '선택', req: 'Y', opts: PAY_OPTS, help: '' }
  ],
  SEAL: [
    { name: '인감종류', kind: '선택', req: 'Y', opts: '법인인감,사용인감', help: '' },
    { name: '날인 문서명', kind: '글', req: 'Y', opts: '', help: '' },
    { name: '제출처', kind: '글', req: 'Y', opts: '', help: '' }
  ],
  LEAVE: [
    { name: '휴가종류', kind: '선택', req: 'Y', opts: '연차,오전반차,오후반차,경조,병가,기타', help: '' },
    { name: '시작일', kind: '날짜', req: 'Y', opts: '', help: '' },
    { name: '종료일', kind: '날짜', req: 'Y', opts: '', help: '' },
    { name: '사유', kind: '여러줄', req: 'N', opts: '', help: '' }
  ]
};

/**
 * 양식항목 시트를 FORM_ITEMS 에 맞춘다. 이미 맞으면 아무것도 쓰지 않는다.
 * v31 — '안내문' 은 어떤 양식이든 전부 비운다 (화면에서 설명문을 없앴다).
 */
function ensureFormItems_() {
  var rows = readObjects_('양식항목');
  var drop = [], add = [], changed = 0;

  // FORM_ITEMS 에 없는 양식(ADD 등)도 안내문만은 비운다
  var managed = {};
  Object.keys(FORM_ITEMS).forEach(function (c) { managed[c] = true; });
  rows.forEach(function (r) {
    var c = String(r['양식코드'] || '').trim();
    if (!c || managed[c]) return;
    if (String(r['안내문'] || '') !== '') {
      updateObject_('양식항목', r._row, { '안내문': '' });
      changed++;
    }
  });

  Object.keys(FORM_ITEMS).forEach(function (code) {
    var want = FORM_ITEMS[code];
    var byName = {};
    want.forEach(function (f, i) { byName[f.name] = { f: f, seq: i + 1 }; });

    var seen = {};
    rows.forEach(function (r) {
      if (String(r['양식코드'] || '').trim() !== code) return;
      var nm = String(r['항목명'] || '').trim();
      var w = byName[nm];
      if (!w || seen[nm]) { drop.push(r._row); return; }   // 목록에 없는 칸·중복은 지운다
      seen[nm] = true;

      var upd = {};
      if (String(r['순번'] || '') !== String(w.seq)) upd['순번'] = w.seq;
      if (String(r['입력형태'] || '') !== w.f.kind) upd['입력형태'] = w.f.kind;
      if (String(r['필수'] || '') !== w.f.req) upd['필수'] = w.f.req;
      if (String(r['선택지'] || '') !== w.f.opts) upd['선택지'] = w.f.opts;
      if (String(r['안내문'] || '') !== w.f.help) upd['안내문'] = w.f.help;
      if (Object.keys(upd).length) { updateObject_('양식항목', r._row, upd); changed++; }
    });

    want.forEach(function (f, i) {
      if (seen[f.name]) return;
      add.push({ '양식코드': code, '순번': i + 1, '항목명': f.name,
                 '입력형태': f.kind, '필수': f.req, '선택지': f.opts, '안내문': f.help });
    });
  });

  if (drop.length) deleteRows_('양식항목', drop);     // 구간으로 묶어서 한 번에
  if (add.length) appendObjects_('양식항목', add);    // 한 번에
  return { drop: drop.length, add: add.length, changed: changed };
}

/** 법인 도장 (전자서명) 시트 */
function ensureSignSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('서명');
  if (!sh) {
    sh = ss.insertSheet('서명');
    sh.getRange(1, 1, 1, 5).setValues([['구분', '대상코드', '이미지', '등록자전화', '등록일시']])
      .setFontWeight('bold').setBackground('#F1F3F4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 320);
    sh.getRange('D2:D').setNumberFormat('@');
    delete _VALS['서명']; delete _OBJ['서명']; delete _HEAD['서명'];
    return;
  }
  ['구분', '대상코드', '이미지', '등록자전화', '등록일시'].forEach(function (c) {
    ensureColumn_('서명', c);
  });
}

/** 법인코드 -> 도장 이미지 링크 */
function signMap_() {
  var o = {};
  readObjects_('서명').forEach(function (r) {
    if (String(r['구분'] || '') !== '법인') return;
    var c = String(r['대상코드'] || '').trim();
    var img = String(r['이미지'] || '').trim();
    if (c && img) o[c] = img;
  });
  return o;
}

/** 누가 무엇을 읽었는지 (업무 상세를 열면 조용히 한 줄 쌓인다) */
function ensureReadSheet_() {
  var ss = ss_();
  if (ss.getSheetByName('읽음')) return;
  var sh = ss.insertSheet('읽음');
  sh.getRange(1, 1, 1, 4).setValues([['대상구분', '대상ID', '전화번호', '읽은일시']])
    .setFontWeight('bold').setBackground('#F1F3F4');
  sh.setFrozenRows(1);
  sh.getRange('C2:C').setNumberFormat('@');   // 전화번호 앞자리 0 보존
  delete _VALS['읽음']; delete _OBJ['읽음']; delete _HEAD['읽음'];
}

/**
 * 게시판·댓글 시트.
 * deep=true(점검에서만) 일 때만 이미 있는 시트의 모자란 열을 채운다.
 * 저장 API에서는 시트가 있는지만 본다 — 열 검사는 열마다 시트를 읽어서 느리다.
 */
function ensurePostSheets_(deep) {
  var ss = ss_();

  var POST_HEAD = ['글번호', '종류', '법인코드', '제목', '내용',
                   '작성자전화', '작성일시', '수정일시', '만료일'];
  if (!ss.getSheetByName('게시글')) {
    var sh = ss.insertSheet('게시글');
    sh.getRange(1, 1, 1, POST_HEAD.length).setValues([POST_HEAD])
      .setFontWeight('bold').setBackground('#F1F3F4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 240); sh.setColumnWidth(5, 380);
    sh.getRange('F2:F').setNumberFormat('@');   // 전화번호 앞자리 0 보존
    sh.getRange('I2:I').setNumberFormat('@');   // 만료일은 글자로
    delete _VALS['게시글']; delete _OBJ['게시글']; delete _HEAD['게시글'];
  } else if (deep) {
    POST_HEAD.forEach(function (c) { ensureColumn_('게시글', c); });
  }

  var CMT_HEAD = ['댓글ID', '대상구분', '대상ID', '작성자전화', '내용', '작성일시'];
  if (!ss.getSheetByName('댓글')) {
    var sh2 = ss.insertSheet('댓글');
    sh2.getRange(1, 1, 1, CMT_HEAD.length).setValues([CMT_HEAD])
      .setFontWeight('bold').setBackground('#F1F3F4');
    sh2.setFrozenRows(1);
    sh2.setColumnWidth(5, 380);
    sh2.getRange('D2:D').setNumberFormat('@');
    delete _VALS['댓글']; delete _OBJ['댓글']; delete _HEAD['댓글'];
  } else if (deep) {
    CMT_HEAD.forEach(function (c) { ensureColumn_('댓글', c); });
  }
}

/**
 * 기본 결재선을 '직원' 시트의 직급에 맞춰 둔다 (하루 1회 점검).
 *   승인 = 직급에 '대표' 가 든 사람 / 열람 = 직급에 '전무' 가 든 사람
 * 전화번호는 코드에 적지 않고 '직원' 시트에서 그때그때 찾는다.
 *
 * ★ 예전에는 스크립트 속성(FORM_LINE_V28)으로 **딱 한 번만** 돌았다.
 *   그래서 나중에 직급을 채우면 반영되지 않았다 —
 *   대표 직급을 먼저 넣고 전무 직급을 나중에 넣었더니 승인자만 들어가고
 *   **열람자가 영영 비어 있었다** (2026-08-28, 휴가 신청서 두 건 연속).
 *   지금은 점검 때마다 견주어 보고 **다른 것만** 고쳐 쓴다.
 *   같으면 시트에 아무것도 쓰지 않으므로 비용이 없다.
 */
function ensureDefaultLine_() {
  var props;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { props = null; }

  var ceo = [], vice = [];
  readObjects_('직원').forEach(function (r) {
    if (r['재직상태'] === '퇴사') return;
    var ph = normPhone_(r['전화번호']);
    if (!ph) return;
    var rank = String(r['직급'] || '').trim();
    if (rank.indexOf('대표') >= 0) ceo.push(ph);        // 대표이사 / 대표 둘 다
    else if (rank.indexOf('전무') >= 0) vice.push(ph);
  });
  // 직급이 아직 안 채워져 있으면 아무것도 하지 않는다 (다음 점검 때 다시 본다)
  if (!ceo.length && !vice.length) return;

  var approvers = ceo.join(','), viewers = vice.join(',');
  var changed = 0;
  readObjects_('문서양식').forEach(function (f) {
    if (!String(f['양식코드'] || '').trim()) return;
    var upd = {};
    // 찾지 못한 쪽은 건드리지 않는다 (기존에 적어둔 값을 지우지 않게)
    if (ceo.length && String(f['기본승인자'] || '') !== approvers) upd['기본승인자'] = approvers;
    if (vice.length && String(f['기본열람자'] || '') !== viewers) upd['기본열람자'] = viewers;
    if (upd['기본승인자'] === undefined && upd['기본열람자'] === undefined) return;
    updateObject_('문서양식', f._row, upd);
    changed += 1;
  });

  // 언제 마지막으로 맞췄는지만 남긴다 (판단에 쓰지 않는다)
  if (props && changed) {
    try { props.setProperty('FORM_LINE_V28', fmtDT_(now_())); } catch (e) {}
  }
}

/**
 * 양식에 '기본승인자' 가 적혀 있지 않을 때 대신 쓸 승인자.
 *   ① 직급에 '대표' 가 든 재직자
 *   ② 없으면 권한등급 9 (관리자)
 *
 * 승인자가 한 명도 없으면 결재선이 빈 문서가 만들어지고,
 * 그런 문서는 관리자라도 누를 줄이 없어 영영 '진행중' 으로 남습니다.
 * 시트를 새로 읽지 않습니다 ('직원' 은 로그인 확인 때 이미 읽었습니다).
 */
function fallbackApprovers_() {
  var ceo = [], adm = [];
  readObjects_('직원').forEach(function (r) {
    if (String(r['재직상태'] || '') === '퇴사') return;
    if (String(r['재직상태'] || '') === '승인대기') return;
    var ph = normPhone_(r['전화번호']);
    if (!ph) return;
    if (String(r['직급'] || '').indexOf('대표') >= 0 && ceo.indexOf(ph) < 0) ceo.push(ph);
    if (Number(r['권한등급'] || 1) >= 9 && adm.indexOf(ph) < 0) adm.push(ph);
  });
  return ceo.length ? ceo : adm;
}

/**
 * '문서양식' 에서 겹치는 줄을 지운다.
 *
 *   ① 양식코드가 같은 줄  → 첫 줄만 남긴다
 *   ② 양식코드는 다른데 양식명이 같은 줄 (구매요청서가 두 번 보이던 경우)
 *      → 그 코드로 올린 결재문서가 하나도 없을 때만 지운다. 쓰던 양식은 절대 안 지운다
 *   ③ 지운 양식에 딸린 '양식항목' 줄과 겹치는 입력칸도 같이 정리
 *
 * 지운 줄 수를 돌려준다.
 */
function dedupForms_() {
  var rows = readObjects_('문서양식');
  if (!rows.length) return { forms: 0, fields: 0, dropCode: {}, kept: [] };

  // 실제로 쓰이고 있는 양식코드는 건드리지 않는다
  var used = {};
  readObjects_('결재문서').forEach(function (d) {
    var c = String(d['양식코드'] || '').trim();
    if (c) used[c] = (used[c] || 0) + 1;
  });

  var seenCode = {}, seenName = {}, drop = [], dropCode = {}, kept = [];
  rows.forEach(function (f) {
    var c = String(f['양식코드'] || '').trim();
    var n = String(f['양식명'] || '').trim();

    if (!c) { drop.push(f._row); return; }              // 양식코드가 빈 줄
    if (seenCode[c]) { drop.push(f._row); return; }     // ① 코드가 겹치는 줄
    seenCode[c] = true;

    if (n && seenName[n] && !used[c]) {                 // ② 이름이 겹치고 쓴 적 없는 줄
      drop.push(f._row); dropCode[c] = true; return;
    }
    if (n) seenName[n] = true;
    kept.push(c + ' · ' + n);
  });
  if (drop.length) deleteRows_('문서양식', drop);

  // ③ 딸린 입력칸 정리
  var seenField = {}, fdrop = [];
  readObjects_('양식항목').forEach(function (r) {
    var c = String(r['양식코드'] || '').trim();
    var k = c + '|' + String(r['항목명'] || '').trim();
    if (!c || dropCode[c]) { fdrop.push(r._row); return; }
    if (seenField[k]) { fdrop.push(r._row); return; }
    seenField[k] = true;
  });
  if (fdrop.length) deleteRows_('양식항목', fdrop);

  return { forms: drop.length, fields: fdrop.length, dropCode: dropCode, kept: kept };
}

/**
 * ★ 결재 양식이 두 번 보일 때 편집기에서 이 함수를 실행하세요 ★
 * 겹치는 줄을 정리하고, 무엇이 있었고 무엇을 지웠는지 알려줍니다.
 */
function 양식_정리하기() {
  var lock = null;
  try { lock = LockService.getScriptLock(); lock.tryLock(20000); } catch (e) { lock = null; }
  /* 잠금을 쥔 채 시트에 쓰므로, 안쪽 쓰기가 또 잠그지 않게 표시해 둔다 (v54) */
  if (lock) markInLock_(true);

  var msg = '';
  try {
    _VALS = {}; _HEAD = {}; _OBJ = {};

    var before = readObjects_('문서양식');
    var lines = ['[정리 전] 문서양식 ' + before.length + '줄'];
    before.forEach(function (f) {
      lines.push('  ' + f._row + '행  코드[' + String(f['양식코드'] || '') + ']' +
        '  이름[' + String(f['양식명'] || '') + ']' +
        '  사용[' + String(f['사용여부'] || '') + ']');
    });

    var r = dedupForms_();
    bumpMeta_();

    lines.push('');
    lines.push('지운 줄 → 문서양식 ' + r.forms + '개, 양식항목 ' + r.fields + '개');
    lines.push('');
    lines.push('[정리 후] 남은 양식 ' + r.kept.length + '개');
    r.kept.forEach(function (k) { lines.push('  ' + k); });
    lines.push('');
    lines.push('앱을 새로고침하면 바로 반영됩니다.');
    msg = lines.join('\n');
  } finally {
    markInLock_(false);
    if (lock) { try { lock.releaseLock(); } catch (e2) {} }
  }

  Logger.log(msg);
  try {
    SpreadsheetApp.getUi().alert('결재 양식 정리', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e3) {}
  return msg;
}

/** 결재 양식을 시트로 관리하기 위한 준비 */
function ensureFormSheets_() {
  var ss = ss_();

  dedupForms_();     // 겹치는 양식 줄 정리 (지금 남아 있는 중복도 여기서 사라진다)

  if (!ss.getSheetByName('양식항목')) {
    var sh = ss.insertSheet('양식항목');
    sh.getRange(1, 1, 1, 7).setValues([['양식코드', '순번', '항목명', '입력형태', '필수', '선택지', '안내문']])
      .setFontWeight('bold').setBackground('#F1F3F4');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 150); sh.setColumnWidth(6, 220); sh.setColumnWidth(7, 220);
    delete _VALS['양식항목']; delete _OBJ['양식항목'];
  }

  if (!ss.getSheetByName('문서상세')) {
    var sh2 = ss.insertSheet('문서상세');
    sh2.getRange(1, 1, 1, 4).setValues([['문서번호', '항목명', '값', '순번']])
      .setFontWeight('bold').setBackground('#F1F3F4');
    sh2.setFrozenRows(1);
    sh2.setColumnWidth(3, 260);
    delete _VALS['문서상세']; delete _OBJ['문서상세'];
  }

  // 정산내역 시트
  if (!ss.getSheetByName('정산내역')) {
    var sh3 = ss.insertSheet('정산내역');
    sh3.getRange(1, 1, 1, 9).setValues([['정산ID', '업무ID', '구분', '금액', '사유',
      '일자', '결재문서번호', '세금계산서', '등록자전화']])
      .setFontWeight('bold').setBackground('#F1F3F4');
    sh3.setFrozenRows(1);
    sh3.setColumnWidth(5, 240);
    delete _VALS['정산내역']; delete _OBJ['정산내역'];
  }

  ensureColumn_('문서양식', '내역사용');
  ensureColumn_('문서양식', '영수증필수');
  ensureColumn_('문서양식', '내역제목');

  // 지출결의서 기본값 채우기 (비어 있을 때만)
  var forms = readObjects_('문서양식');
  var exp = null, pur = null;
  forms.forEach(function (f) {
    if (f['양식코드'] === 'EXP') exp = f;
    if (f['양식코드'] === 'PUR') pur = f;
  });
  if (exp && !String(exp['내역사용'] || '').trim()) {
    updateObject_('문서양식', exp._row, { '내역사용': 'Y', '영수증필수': 'Y', '내역제목': '지출 내역' });
  }

  // 추가공사 승인요청 (없을 때만)
  var add = null;
  forms.forEach(function (f) { if (f['양식코드'] === 'ADD') add = f; });
  if (!add && exp) {
    appendObject_('문서양식', {
      '양식코드': 'ADD', '양식명': '추가공사 승인요청', '사용여부': 'Y',
      '기본승인자': exp['기본승인자'], '기본열람자': exp['기본열람자'],
      '내역사용': 'Y', '영수증필수': 'N', '내역제목': '추가 공사 내역', '표시순서': 3
    });
    appendObjects_('양식항목', [
      { '양식코드': 'ADD', '순번': 1, '항목명': '발생사유', '입력형태': '여러줄', '필수': 'Y',
        '선택지': '', '안내문': '고객 요청인지, 현장 조건 변경인지 구체적으로' },
      { '양식코드': 'ADD', '순번': 2, '항목명': '고객 합의', '입력형태': '선택', '필수': 'Y',
        '선택지': '구두 합의 완료,합의 전(승인 후 협의),서면 합의', '안내문': '' }
    ]);
  }

  // 구매요청서 추가 (없을 때만)
  if (!pur && exp) {
    appendObject_('문서양식', {
      '양식코드': 'PUR', '양식명': '구매요청서', '사용여부': 'Y',
      '기본승인자': exp['기본승인자'], '기본열람자': exp['기본열람자'],
      '내역사용': 'Y', '영수증필수': 'N', '내역제목': '구매 품목', '표시순서': 2
    });
  }

  // EXP·PUR 기본 입력칸은 ensureFormItems_() 가 맞춘다 (점검 뒷부분)

  /* 인감 날인 품의서 · 휴가 신청서 — 없을 때만 만든다 */
  var have = {};
  forms.forEach(function (f) { have[String(f['양식코드'] || '').trim()] = true; });

  var newForms = [];

  if (!have['SEAL']) {
    newForms.push({
      '양식코드': 'SEAL', '양식명': '인감 날인 품의서', '사용여부': 'Y',
      '기본승인자': exp ? exp['기본승인자'] : '', '기본열람자': exp ? exp['기본열람자'] : '',
      '내역사용': 'N', '영수증필수': 'N', '내역제목': '', '표시순서': 4
    });
  }

  if (!have['LEAVE']) {
    newForms.push({
      '양식코드': 'LEAVE', '양식명': '휴가 신청서', '사용여부': 'Y',
      '기본승인자': exp ? exp['기본승인자'] : '', '기본열람자': exp ? exp['기본열람자'] : '',
      '내역사용': 'N', '영수증필수': 'N', '내역제목': '', '표시순서': 5
    });
  }

  // 한 번에 쓴다 (한 줄씩 쓰지 않는다). 입력칸은 ensureFormItems_() 가 맞춘다
  if (newForms.length) appendObjects_('문서양식', newForms);
}

// ★ 여기에 있던 include_() 를 지웠습니다 (v54).
//   HtmlService 로 화면 조각을 읽어오던 함수인데 아무도 부르지 않는 죽은 코드였고,
//   HtmlService 를 프로젝트에서 완전히 몰아내기 위해 같이 지웠습니다.

// =============================================================
//  공통 유틸
// =============================================================

/**
 * 이 스크립트가 붙어 있는 스프레드시트를 자동으로 찾습니다.
 * 웹앱으로 실행될 때를 대비해 첫 실행 때 ID를 기억해 둡니다.
 */
function ss_() {
  if (_SS) return _SS;
  var _t0 = new Date().getTime();

  var s = null;
  try { s = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { s = null; }

  var props = PropertiesService.getScriptProperties();
  if (s) {
    // 매 요청마다 쓰지 않는다. 값이 다를 때만 (속성 쓰기도 공짜가 아니다)
    var sid = s.getId();
    if (props.getProperty('SS_ID') !== sid) props.setProperty('SS_ID', sid);
  } else {
    var id = props.getProperty('SS_ID');
    if (id) {
      try { s = SpreadsheetApp.openById(id); } catch (e2) { s = null; }
    }
  }

  if (!s) {
    throw new Error('스프레드시트를 찾을 수 없습니다. 스프레드시트에서 [확장 프로그램] > [Apps Script]로 연 편집기인지 확인해주세요.');
  }
  _SS = s;
  add_('열기:스프레드시트', _t0);
  return s;
}

/** 시트 손잡이 찾기. 몇 번 물었고 얼마나 걸렸는지 재둔다 */
function sheet_(name) {
  var t0 = new Date().getTime();
  var sh = ss_().getSheetByName(name);
  add_('손잡이:' + name, t0);
  return sh;
}

function now_() { return new Date(); }

/* -------------------------------------------------------------
 *  날짜를 글자로 (v41)
 *
 *  ★ Utilities.formatDate 를 쓰지 않는다.
 *    Apps Script 에서 이 함수는 한 번에 1ms 가까이 든다.
 *    v40 측정에서 업무 카드 6장을 그리는 데만 24번을 불러 27ms 를 쓰고 있었다.
 *    board_ 전체가 134ms 이던 때라 그 중 20%가 날짜 찍기였다.
 *
 *  ★ 서울은 서머타임이 없어 **언제나 UTC+9** 다.
 *    그래서 9시간을 더한 뒤 UTC 로 읽으면 서울 시각이 그대로 나온다.
 *    `날짜_확인()` 이 옛 방식과 새 방식이 한 글자도 다르지 않은지 검사한다.
 *    이 부분을 고치면 반드시 그 함수를 다시 돌려보세요.
 * ----------------------------------------------------------- */
var KST_MS = 9 * 60 * 60 * 1000;

function z2_(n) { return n < 10 ? '0' + n : '' + n; }
function z4_(n) { return n < 10 ? '000' + n : (n < 100 ? '00' + n : (n < 1000 ? '0' + n : '' + n)); }

/** 서울 기준 연·월·일·시·분 */
function kst_(d) {
  var t = new Date(d.getTime() + KST_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(),
           h: t.getUTCHours(), mi: t.getUTCMinutes() };
}

function fmtDT_(d) {
  if (!d) return '';
  if (!(d instanceof Date)) return String(d);
  var p = kst_(d);
  return z4_(p.y) + '-' + z2_(p.mo) + '-' + z2_(p.d) + ' ' + z2_(p.h) + ':' + z2_(p.mi);
}
function fmtD_(d) {
  if (!d) return '';
  if (!(d instanceof Date)) return String(d).substring(0, 10);
  var p = kst_(d);
  return z4_(p.y) + '-' + z2_(p.mo) + '-' + z2_(p.d);
}
/** yyyy-MM (이번 달 실적 계산용) */
function fmtM_(d) {
  if (!d) return '';
  if (!(d instanceof Date)) return String(d).substring(0, 7);
  var p = kst_(d);
  return z4_(p.y) + '-' + z2_(p.mo);
}
function today_() { return fmtD_(now_()); }

/** 시각을 HH:mm 글자로. 시트에서 시간·날짜 데이터로 들어와도 안전하게 처리 */
function fmtT_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) { var p = kst_(v); return z2_(p.h) + ':' + z2_(p.mi); }
  var t = String(v).trim();
  var m = t.match(/(\d{1,2}):(\d{2})/);       // "오전 9:12", "09:12:33" 등에서 시:분만
  if (m) {
    var hh = m[1].length === 1 ? '0' + m[1] : m[1];
    if (t.indexOf('오후') >= 0 && Number(m[1]) < 12) hh = String(Number(m[1]) + 12);
    if (t.indexOf('오전') >= 0 && Number(m[1]) === 12) hh = '00';
    return hh + ':' + m[2];
  }
  return '';
}
function stamp_() {
  var p = kst_(now_());
  return z2_(p.y % 100) + z2_(p.mo) + z2_(p.d);
}

/**
 * 시트 칸 하나를 화면에 내보낼 글자로 바꾼다.
 *
 * '2026-08-28' 이라고 넣어도 시트가 날짜로 알아서 바꿔 담습니다.
 * 그것을 String() 으로 꺼내면 'Fri Aug 28 2026 00:00:00 GMT+0900 (한국 표준시)'
 * 가 되어 화면에 그대로 나옵니다 (2026-08-28 휴가 신청서에서 실제로 나왔습니다).
 * 자정이면 날짜만, 시각이 붙어 있으면 날짜와 시각으로 돌립니다.
 */
function cellText_(v) {
  if (v === null || v === undefined) return '';
  if (!(v instanceof Date)) return String(v);
  var p = kst_(v);
  return (p.h === 0 && p.mi === 0) ? fmtD_(v) : fmtDT_(v);
}

function digits_(v) { return String(v == null ? '' : v).replace(/[^0-9]/g, ''); }
function normPhone_(v) {
  var d = digits_(v);
  if (d.length === 10 && d.charAt(0) !== '0') d = '0' + d;
  return d;
}

/* -------------------------------------------------------------
 *  요청 1회 동안만 살아있는 캐시.
 *  같은 시트를 여러 번 읽지 않고, 쓰기는 한 줄을 통째로 한 번에 한다.
 * ----------------------------------------------------------- */
var _T = {};      // 라벨 -> 걸린 밀리초 합계
var _TC = {};     // 라벨 -> 실제로 실행된 횟수
var _TH = {};     // 시트 -> 캐시가 막아낸 횟수 (캐시가 듣고 있는지 확인용)
var _TN = {};     // 시트 -> 줄 수 / 열 수
var _OBJ = {};    // 시트명 -> 객체 배열 (요청 안에서만 재사용)
var _VALS = {};   // 시트명 -> 2차원 배열
var _HEAD = {};   // 시트명 -> 헤더 배열
var _TOUCHED = false;              // 이번 요청에서 이미 시각을 찍었는지
var _LASTUP = '';                  // 이번 요청에서 찍은 바뀜시각 (다시 물어보지 않으려고)
var _META = null;                  // 기준정보 캐시 (요청 안에서 재사용)
var _START = new Date().getTime(); // 이 요청이 시작된 시각 (응답에 처리시간 표시용)
var SETUP_VER = 'v49';             // 시트 구조가 바뀌면 이 값을 올린다. 점검이 한 번 다시 돈다

/* -------------------------------------------------------------
 *  속도 재기 (v37m)
 *
 *  고치기 전에 어디에 시간이 쓰이는지부터 숫자로 본다.
 *  재는 비용은 Date 두 번이라 사실상 0이므로 항상 켜둔다.
 *
 *  라벨 규칙
 *    열기:...   스프레드시트를 여는 시간
 *    손잡이:... getSheetByName
 *    시트:...   getValues (진짜 읽기)
 *    머리글:... 머리글 한 줄만 읽기
 *    객체:...   읽어온 값을 객체로 만드는 시간 (구글이 아니라 우리 계산)
 *    쓰기:...   setValues / deleteRows
 *    속성:...   PropertiesService / CacheService
 *    단계:...   응답을 만드는 구간 (logsByTask, settle, docPack ...)
 * ----------------------------------------------------------- */

/** 걸린 시간을 라벨에 더한다 */
function add_(key, t0) {
  _T[key] = (_T[key] || 0) + (new Date().getTime() - t0);
  _TC[key] = (_TC[key] || 0) + 1;
}

/** 한 구간을 통째로 재고 결과를 그대로 돌려준다 */
function span_(key, fn) {
  var t0 = new Date().getTime();
  try { return fn(); }
  finally { add_(key, t0); }
}

/** 캐시가 막아낸 횟수 (같은 시트를 또 물어본 횟수) */
function hit_(name) { _TH[name] = (_TH[name] || 0) + 1; }

/* =============================================================
 *  시트 캐시 (안 D · v39)
 *
 *  v37 실측: board_() 3,753ms 중 88%가 시트 왕복 15회였다.
 *  우리 계산은 전부 합쳐 40ms 였다. 그래서 줄일 것은 왕복 횟수뿐이다.
 *  기준정보(meta)가 이미 같은 방식으로 70배(31ms vs 2,180ms)를 내고 있었다. 그걸 넓힌 것이다.
 *
 *  ── 어떻게 도는가 ──
 *  1. 시트마다 '번호표' 를 스크립트 속성에 하나씩 둔다 (V_업무, V_직원 ...)
 *  2. 캐시 칸 이름 = 시트이름 + 번호표. 번호표가 바뀌면 옛 칸은 아무도 안 본다
 *  3. 요청에서 시트를 처음 읽을 때 getProperties() 1번 + getAll() 1번으로 전부 가져온다
 *  4. 시트에 쓰면 그 시트의 번호표만 새로 만든다 → 바뀐 시트 한 장만 다시 읽는다
 *
 *  ── 반드시 지킬 것 ──
 *  ★ 번호표는 '1씩 증가' 가 아니라 **매번 새로 만드는 값**(시각+난수)이다.
 *    두 사람이 같은 순간에 저장해도 서로 덮어쓰지 않는다.
 *  ★ 번호표는 시트마다 **속성 키를 따로** 쓴다. 한 칸에 JSON 으로 모으면
 *    동시에 저장할 때 한쪽이 다른 쪽 번호를 되돌려버린다.
 *    읽을 때는 getProperties() 한 번에 다 오므로 속도 손해가 없다.
 *  ★ **저장할 때 캐시를 채우지 않는다.** 번호만 바꿔 무효로 만들고,
 *    다음에 읽는 쪽이 새로 채운다. 최악이 '한 번 느림' 이어야지 '틀린 값' 이면 안 된다.
 *  ★ 캐시 한 칸 한도(100KB)를 넘는 시트는 **옛 방식(시트 직접 읽기)으로 자동 후퇴**하고
 *    넘었다는 사실을 실행 기록에 남긴다. 느려질 뿐 틀리지 않는다.
 * ----------------------------------------------------------- */
var SHEET_CACHE_ON = true;         // 문제가 생기면 이 한 줄을 false 로 바꾸면 옛 방식으로 완전히 돌아간다
var CACHE_SEC = 21600;             // 6시간 (구글 최대)
var CACHE_MAX_BYTES = 95000;       // 한 칸 100KB 한도. 실제 바이트로 재서 여유를 다 쓴다 (v43)
var CACHE_SHEETS = ['직원', '업무', '업무일지', '결재문서', '결재선', '결재내역', '문서상세',
                    '정산내역', '댓글', '첨부', '게시글', '알림', '연동캐시', '설정', '서명',
                    '읽음', '휴가', '일정', '일정구분'];
/* ★ '휴가'(v46) · '일정'·'일정구분'(v47) 이 여기 들어 있어야 달력이 board 와
     **같은 한 번(getAll)** 에 실려 온다. 빼면 달력을 열 때마다 시트를 새로 읽는다. */

/* 여기 적힌 시트에 쓰는 것은 '바뀜 시각'(LAST_UPDATE)을 건드리지 않는다 (v43).
   ★ 업무 상세를 **열기만** 해도 읽음 기록이 쌓이는데, 그때마다 바뀜 시각이 올라가면
     직원 6명 전원의 60초 확인이 board 전체를 다시 받는다.
     보기만 한 동작이 남의 새로고침을 일으켜서는 안 된다.
     캐시 번호표는 그대로 올라가므로 값이 낡지는 않는다. */
var QUIET_SHEETS = { '읽음': 1, '로그': 1 };

var _VER = null;                   // 시트 번호표 전부 (요청당 1번만 읽는다)
var _CGOT = null;                  // 캐시에서 한꺼번에 가져온 것
var _CBIG = {};                    // 캐시에 안 들어가는 시트 (한도 초과)

/** 매번 새로 만드는 값. 증가하는 숫자를 쓰면 동시 저장에서 서로 덮어쓴다 */
function newStamp_() {
  return new Date().getTime().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

/** 번호표 전부 (getProperties 1번) */
function verAll_() {
  if (_VER) return _VER;
  var t0 = new Date().getTime();
  try { _VER = PropertiesService.getScriptProperties().getProperties() || {}; }
  catch (e) { _VER = {}; }
  add_('속성:번호표읽기', t0);
  return _VER;
}

function verOf_(name) { return String(verAll_()['V_' + name] || '0'); }
function cacheKey_(name) { return 'S|' + name + '|' + verOf_(name); }

/** 한 시트를 무효로 만든다 (캐시를 채우지는 않는다) */
function bumpSheet_(name) {
  if (!name || !SHEET_CACHE_ON) return;
  if (CACHE_SHEETS.indexOf(name) < 0) return;   // 담지 않는 시트는 번호표도 필요 없다 (로그 등)
  var v = newStamp_();
  var t0 = new Date().getTime();
  try { PropertiesService.getScriptProperties().setProperty('V_' + name, v); } catch (e) {}
  add_('속성:번호표쓰기', t0);
  if (_VER) _VER['V_' + name] = v;
  if (_CGOT) delete _CGOT[name];
}

/** 전부 무효 (손으로 시트를 고쳤을 때 · 기준정보 새로고침 · 하루 1회 점검) */
function bumpAllSheets_() {
  var o = {};
  CACHE_SHEETS.forEach(function (n) { o['V_' + n] = newStamp_(); });
  var t0 = new Date().getTime();
  try { PropertiesService.getScriptProperties().setProperties(o); } catch (e) {}
  add_('속성:번호표전체쓰기', t0);
  _VER = null; _CGOT = null;
}

/**
 * 이 요청에서 쓸 것을 캐시에서 **한 번에** 가져온다 (왕복 1회).
 * ★ 기준정보(meta)도 같이 가져온다 (v40). 예전에는 시트용 getAll 과 기준정보용 get 을
 *   따로 불러서 캐시를 두 번 두드렸다 (v39 측정 39ms + 56ms).
 */
function cachePrefetch_() {
  if (_CGOT) return _CGOT;
  _CGOT = {};
  if (!SHEET_CACHE_ON) return _CGOT;

  var keys = [], back = {};
  CACHE_SHEETS.forEach(function (n) {
    var k = cacheKey_(n);
    keys.push(k); back[k] = n;
  });
  var mk = 'META_' + metaVer_();
  keys.push(mk); back[mk] = '@meta';
  var ak = attKey_();
  keys.push(ak); back[ak] = '@att';        // 출퇴근 현황도 같은 한 번에 (v41)

  var t0 = new Date().getTime();
  try {
    var got = CacheService.getScriptCache().getAll(keys) || {};
    for (var k in got) _CGOT[back[k]] = got[k];
  } catch (e) {}
  add_('캐시:한번에읽기', t0);
  _TN['캐시적중'] = { rows: Object.keys(_CGOT).length, cols: keys.length };
  return _CGOT;
}

/** 읽어온 시트 값을 캐시에 담는다 (읽을 때만. 저장할 때는 담지 않는다) */
function cachePutVals_(name, vals) {
  if (!SHEET_CACHE_ON || CACHE_SHEETS.indexOf(name) < 0) return;
  var t0 = new Date().getTime();
  try {
    var s = cacheEnc_(vals);
    var bytes = byteLen_(s);
    if (bytes > CACHE_MAX_BYTES) {
      _CBIG[name] = true;
      console.log('[캐시] ' + name + ' 시트가 캐시 한도를 넘었습니다 (' + bytes +
                  '바이트 > ' + CACHE_MAX_BYTES + '). 이 시트는 예전처럼 시트에서 직접 읽습니다.');
      markBig_(name, bytes);
      add_('캐시:한도초과:' + name, t0);
      return;
    }
    CacheService.getScriptCache().put(cacheKey_(name), s, CACHE_SEC);
    markBig_(name, 0);
    add_('캐시:담기:' + name, t0);
  } catch (e) {}
}

/** 글자가 실제로 몇 바이트인지 (한글은 3바이트). 캐시 한도는 바이트 기준이다 */
function byteLen_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    n += (c < 0x80) ? 1 : (c < 0x800 ? 2 : 3);
  }
  return n;
}

/**
 * 한도를 넘은 시트를 표시해둔다 (0 이면 표시를 지운다).
 * ★ 조용히 넘어가면 아무도 모른다. 설정 화면에서 관리자가 볼 수 있게 남긴다 (v43).
 * 상태가 바뀔 때만 속성에 쓰므로 평소에는 왕복이 늘지 않는다.
 */
function markBig_(name, bytes) {
  try {
    var key = 'BIG_' + name;
    var had = !!verAll_()[key];
    if (bytes && !had) {
      PropertiesService.getScriptProperties().setProperty(key, String(bytes));
      if (_VER) _VER[key] = String(bytes);
    } else if (!bytes && had) {
      PropertiesService.getScriptProperties().deleteProperty(key);
      if (_VER) delete _VER[key];
    }
  } catch (e) {}
}

/** 캐시에 못 담고 있는 시트 목록 (설정 화면에 보여준다) */
function bigSheets_() {
  var out = [], all = verAll_();
  for (var k in all) {
    if (k.indexOf('BIG_') === 0) out.push({ name: k.substring(4), bytes: Number(all[k] || 0) });
  }
  return out;
}

/**
 * 분야별 번호표 (v43).
 *
 * ★ 화면이 '내가 들고 있는 것이 아직 쓸 만한가' 를 판단할 때 쓴다.
 *   예전에는 `LAST_UPDATE` 하나로 판단했는데, 그건 **누가 무엇을 저장하든** 바뀐다.
 *   그래서 남이 업무 하나만 저장해도 결재 문서 캐시·게시글 캐시가 통째로 버려졌고,
 *   문서를 누를 때마다 왕복 1회가 되살아났다 (v35에서 없앤 그 왕복이다).
 *   이제 결재는 결재 시트가 바뀔 때만, 게시글은 게시글·댓글이 바뀔 때만 버린다.
 *
 * 번호표는 이미 속성에 다 들어 있으므로 만드는 데 왕복이 늘지 않는다.
 */
function areaVers_() {
  function v(list) {
    return list.map(function (n) { return verOf_(n); }).join('|');
  }
  return {
    doc:  v(['결재문서', '결재선', '결재내역', '문서상세', '첨부']),
    post: v(['게시글', '댓글']),
    cal:  v(['일정', '일정구분']),
    set:  v(['설정', '직원', '서명'])
  };
}

/**
 * 시트를 통째로 읽는다.
 * 캐시에 있으면 시트를 아예 열지 않는다 (v39). 없을 때만 읽고, 읽은 김에 캐시에 담는다.
 */
function values_(name) {
  if (_VALS[name]) { hit_('시트:' + name); return _VALS[name]; }

  // ① 캐시에 있으면 시트를 열지 않는다
  if (SHEET_CACHE_ON) {
    var got = cachePrefetch_();
    if (got[name]) {
      var tc = new Date().getTime();
      try {
        var v = cacheDec_(got[name]);
        _VALS[name] = v;
        _HEAD[name] = v[0];
        _TN[name] = { rows: Math.max(0, v.length - 1), cols: v[0] ? v[0].length : 0 };
        add_('캐시:되살리기:' + name, tc);
        return v;
      } catch (e) {
        delete _VALS[name]; delete _HEAD[name];   // 깨졌으면 그냥 시트에서 읽는다
      }
    }
  }

  // ② 캐시에 없으면 시트에서 읽는다
  var t0 = new Date().getTime();
  var sh = sheet_(name);
  if (!sh) { _VALS[name] = []; return []; }
  var last = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (last < 1 || lastCol < 1) { _VALS[name] = []; return []; }
  _VALS[name] = sh.getRange(1, 1, last, lastCol).getValues();
  _HEAD[name] = _VALS[name][0];
  add_('시트:' + name, t0);
  _TN[name] = { rows: last - 1, cols: lastCol };

  cachePutVals_(name, _VALS[name]);
  return _VALS[name];
}

/**
 * 캐시 데우기 (5분 트리거가 부른다).
 * 이미 담겨 있는 시트는 건드리지 않는다. 비어 있는 것만 읽어서 채운다.
 * 사람이 차가운 캐시를 만나 3.3초를 무는 일이 없게 하려는 것이다.
 */
function warmCache_() {
  if (!SHEET_CACHE_ON) return [];
  var got = cachePrefetch_();
  var missing = CACHE_SHEETS.filter(function (n) { return !got[n] && !_CBIG[n]; });
  missing.forEach(function (n) {
    try { values_(n); } catch (e) {}
  });
  return missing;
}

/**
 * 이번 요청에서 무엇이 몇 밀리초 걸렸는지.
 *   ms    라벨별 밀리초
 *   n     라벨별 실행 횟수
 *   hit   캐시가 막아낸 횟수
 *   rows  시트별 줄 수·열 수
 */
function timing_() {
  var ms = {}, n = {}, hit = {}, rows = {};
  for (var k in _T) ms[k] = _T[k];
  for (var c in _TC) n[c] = _TC[c];
  for (var h in _TH) hit[h] = _TH[h];
  for (var r in _TN) rows[r] = _TN[r];
  return { _total: took_(), ms: ms, n: n, hit: hit, rows: rows };
}

/** 실행 기록(구글 클라우드 로그)에도 한 줄로 남긴다 */
function logTiming_(who) {
  try {
    var t = timing_();
    var arr = [];
    for (var k in t.ms) arr.push([k, t.ms[k]]);
    arr.sort(function (a, b) { return b[1] - a[1]; });
    var top = arr.slice(0, 14).map(function (x) {
      return x[0] + ' ' + x[1] + 'ms' + ((t.n[x[0]] || 1) > 1 ? '×' + t.n[x[0]] : '');
    }).join(' | ');
    console.log('[속도] ' + who + ' 총 ' + t._total + 'ms :: ' + top);
  } catch (e) {}
}

/** 머리글만 필요할 때 시트 전체를 읽지 않는다 */
function headers_(name) {
  return headFast_(name);
}

function colIndex_(name, colName) {
  var head = headers_(name);
  for (var i = 0; i < head.length; i++) if (String(head[i]) === colName) return i;
  return -1;
}

/**
 * 시트를 객체 배열로 읽기.
 *
 * ★ 한 요청 안에서 같은 시트를 여러 번 물어도 객체를 다시 만들지 않는다 (_OBJ).
 *   예전에는 부를 때마다 전 행을 새 객체로 다시 지었다.
 *   board_ 하나만 해도 '직원' 을 네 번, 그 밖의 시트를 여러 번 다시 지었다.
 *   시트에 쓰면 _OBJ 를 버리므로 낡은 값이 남지 않는다 (dropObj_).
 *
 * 돌려준 배열과 그 안의 객체는 **고쳐 쓰면 안 된다.** 정렬이 필요하면 filter/slice 먼저.
 */
function readObjects_(name) {
  if (_OBJ[name]) { hit_('객체:' + name); return _OBJ[name]; }

  var vals = values_(name);
  if (vals.length < 2) { _OBJ[name] = []; return _OBJ[name]; }

  var _t0 = new Date().getTime();
  var head = vals[0];
  var hn = head.length;
  var keys = [];                       // 빈 머리글 열은 건너뛴다
  for (var c = 0; c < hn; c++) keys.push(head[c] ? String(head[c]) : '');

  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var row = vals[i];
    // 빈 줄 판정 — 예전에는 row.join('') 으로 줄 전체를 글자로 이어붙였다 (느리다).
    // 공백만 들어 있는 칸도 빈 것으로 보던 예전 동작을 그대로 지킨다.
    var blank = true;
    for (var b = 0; b < row.length; b++) {
      var v = row[b];
      if (v === '' || v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      blank = false; break;
    }
    if (blank) continue;

    var o = { _row: i + 1 };
    for (var k = 0; k < hn; k++) {
      if (keys[k]) o[keys[k]] = row[k];
    }
    out.push(o);
  }
  _OBJ[name] = out;
  add_('객체:' + name, _t0);
  return out;
}

/**
 * 시트에 쓴 뒤에는 만들어둔 객체를 버린다.
 * ★ 여기서 그 시트의 번호표도 새로 만든다 (v39). 쓰기는 전부 이 함수를 지나가므로
 *   무효 처리를 한 곳에 모아둘 수 있다. 캐시를 **채우지는 않는다** — 다음에 읽는 쪽이 채운다.
 */
function dropObj_(name) {
  if (name) { delete _OBJ[name]; bumpSheet_(name); }
  else _OBJ = {};
}

/**
 * 계속 쌓이기만 하는 시트(알림 같은 것)를 **뒤에서 n줄만** 읽는다.
 * 전체를 읽으면 줄 수만큼 느려진다. 최근 것만 쓰는 자리에서 쓴다.
 */
function tailObjects_(name, n) {
  if (_OBJ[name]) { hit_('시트:' + name + '(꼬리)'); return _OBJ[name]; }

  /* ★ 캐시에 통째로 들어 있으면 시트를 **아예 건드리지 않는다** (v40).
     v39 에서는 여기서 sheet_() · getLastRow() · getLastColumn() 을 먼저 부르고
     그 다음에야 캐시를 썼다. 캐시를 만들어놓고 시트를 세 번 두드린 셈이라
     알림 169ms · 게시글도 비슷하게 헛돈을 쓰고 있었다 (v39 측정).
     구글에 묻지 않고 알 수 있는 것부터 본다. */
  if (_VALS[name]) return readObjects_(name);
  if (SHEET_CACHE_ON && CACHE_SHEETS.indexOf(name) >= 0 && cachePrefetch_()[name]) {
    return readObjects_(name);
  }

  var t0 = new Date().getTime();
  var sh = sheet_(name);
  if (!sh) return [];
  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 2 || lastCol < 1) return [];

  /* 시트가 아직 n줄을 안 넘었으면 통째로 한 번에 읽는다 (v38).
     꼬리만 읽으려면 머리글을 따로 한 번 더 읽어야 해서 같은 시트에 왕복이 2번 든다.
     여기서는 왕복 1번이 줄 수보다 훨씬 비싸다 (0줄 시트도 275ms 든다). */
  if (last - 1 <= n) {
    add_('단계:꼬리판정:' + name, t0);
    return readObjects_(name);
  }

  var from = Math.max(2, last - n + 1);
  var head = headFast_(name);
  if (!head.length) return [];

  var vals = sh.getRange(from, 1, last - from + 1, head.length).getValues();
  add_('시트:' + name + '(꼬리)', t0);
  _TN[name + '(꼬리)'] = { rows: vals.length, cols: head.length, all: last - 1 };
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var blank = true;
    for (var b = 0; b < row.length; b++) {
      var v = row[b];
      if (v === '' || v === null || v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      blank = false; break;
    }
    if (blank) continue;
    var o = { _row: from + i };
    for (var k = 0; k < head.length; k++) {
      if (head[k]) o[String(head[k])] = row[k];
    }
    out.push(o);
  }
  return out;
}

/**
 * 머리글 한 줄만 읽는다.
 * ★ 줄을 덧붙이려고 시트 전체를 읽으면 안 된다.
 *   로그·알림·결재선처럼 계속 쌓이는 시트는 갈수록 느려진다 (v33까지 실제로 그랬다).
 */
function headFast_(name) {
  if (_HEAD[name]) { hit_('머리글:' + name); return _HEAD[name]; }
  var t0 = new Date().getTime();
  var sh = sheet_(name);
  if (!sh) { _HEAD[name] = []; return []; }
  var lc = sh.getLastColumn();
  if (lc < 1) { _HEAD[name] = []; return []; }
  _HEAD[name] = sh.getRange(1, 1, 1, lc).getValues()[0];
  add_('머리글:' + name, t0);
  return _HEAD[name];
}

/**
 * 붙일 자리.
 *
 * ★ 담아둔 값과 시트의 실제 마지막 줄 중 **더 아래쪽**을 쓴다 (v39).
 *   담아둔 값이 시트보다 짧으면(누가 시트에 손으로 줄을 넣은 경우) 그 줄을 덮어써 버린다.
 *   getLastRow() 는 줄 내용을 읽지 않는 값싼 호출이라, 이 안전장치는 거의 공짜다.
 *   느려지는 것은 참아도 남의 줄을 지우는 것은 참으면 안 된다.
 */
function appendAt_(name, sh) {
  var byCache = (_VALS[name] && _VALS[name].length) ? _VALS[name].length + 1 : 0;
  var bySheet = sh.getLastRow() + 1;
  return Math.max(byCache, bySheet);
}

/* =============================================================
 *  저장 잠금 (v54)
 * -------------------------------------------------------------
 *  왜 넣었나 — 2026-08-30 점검에서 나온 것입니다.
 *
 *  직원 여섯 명이 아침에 동시에 저장하면 이런 일이 생길 수 있었습니다.
 *    · nextId_ 가 둘 다 같은 번호를 내준다 (문서번호가 두 건)
 *    · appendAt_ 이 둘 다 같은 줄 번호를 내준다
 *      → 뒤에 쓴 사람이 앞사람 줄을 **덮어써서 한 건이 통째로 사라진다**
 *  오류가 나지 않아 사라진 사람은 알 수도 없었습니다.
 *
 *  현장견적의 issueEstimateCode_ 가 쓰던 방식을 그대로 가져왔습니다.
 *  새로 설계하지 않았습니다.
 *
 *  ★ 지킬 것
 *    · 기다리는 시간은 짧게 (4초). 20초를 기다리면 사람은 흰 화면을 봅니다.
 *      못 잡으면 오류를 던지고, 연결.js 의 doPost 가
 *      '잠시 후 다시 시도해 주세요' 로 바꿔 돌려줍니다.
 *    · 잡았으면 반드시 푼다 (finally).
 *    · 잠금 안에서는 번호 매기기와 쓰기만 한다. 읽기·계산은 밖에서.
 *    · _INLOCK — 한 실행이 이미 잡고 있으면 다시 잡지 않는다.
 *      점검_지금하기() 처럼 잠금을 잡은 채 여러 줄을 쓰는 곳이 있는데,
 *      거기서 또 잡으려 하면 **자기 자신을 기다리다 멈춥니다.**
 * ============================================================= */
var LOCK_WAIT_MS = 4000;
var _INLOCK = false;

function withLock_(work) {
  if (_INLOCK) return work();          // 이 실행이 이미 잡고 있다
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (e) { lock = null; }
  if (!lock) return work();            // 잠금을 못 쓰는 환경이면 예전처럼 (멈추는 것보다 낫다)

  var got = false;
  try { got = lock.tryLock(LOCK_WAIT_MS); } catch (e) { got = false; }
  if (!got) throw new Error('저장이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.');

  _INLOCK = true;
  try { return work(); }
  finally {
    _INLOCK = false;
    try { lock.releaseLock(); } catch (e) {}
  }
}

/** 이미 잠금을 잡고 있는 곳(점검·정리)이 안쪽 쓰기와 부딪히지 않게 알려준다 */
function markInLock_(on) { _INLOCK = !!on; }

/** 객체 한 건을 시트 맨 아래에 추가 (쓰기 1회, 읽기 0회) */
function appendObject_(name, obj) {
  var sh = sheet_(name);
  if (!sh) return 0;
  var head = headFast_(name);
  if (!head.length) return 0;

  var row = [];
  for (var i = 0; i < head.length; i++) {
    var v = obj[head[i]];
    row.push(v === undefined || v === null ? '' : v);
  }
  /* ★ 붙일 자리를 정하는 것과 쓰는 것을 같은 잠금 안에서 한다 (v54).
     밖에서 정하면 두 사람이 같은 줄 번호를 받아 한 건이 사라진다.
     flush() 는 쓴 것을 바로 시트에 반영해, 다음 사람이 getLastRow() 로
     이 줄을 보게 하려는 것이다. 이것이 없으면 잠금이 있어도 소용이 없다. */
  var target = withLock_(function () {
    var at = appendAt_(name, sh);
    var _t0 = new Date().getTime();
    sh.getRange(at, 1, 1, head.length).setValues([row]);
    SpreadsheetApp.flush();
    add_('쓰기:' + name, _t0);
    return at;
  });
  if (_VALS[name] && _VALS[name].length) _VALS[name].push(row);   // 캐시도 같이 갱신
  dropObj_(name);
  touchFor_(name);
  return target;
}

/** 특정 행을 부분 수정 (열마다 따로 쓰지 않고 한 줄을 한 번에) */
function updateObject_(name, rowIndex, obj) {
  var sh = sheet_(name);
  var head = headers_(name);
  var vals = values_(name);
  var cur = vals[rowIndex - 1];
  if (!cur) {
    cur = sh.getRange(rowIndex, 1, 1, head.length).getValues()[0];
  }
  var row = cur.slice(0, head.length);
  while (row.length < head.length) row.push('');

  var changed = false;
  for (var i = 0; i < head.length; i++) {
    if (obj.hasOwnProperty(head[i])) {
      var v = obj[head[i]];
      row[i] = (v === undefined || v === null) ? '' : v;
      changed = true;
    }
  }
  if (!changed) return;

  var _t0 = new Date().getTime();
  sh.getRange(rowIndex, 1, 1, head.length).setValues([row]);
  add_('쓰기:' + name, _t0);
  vals[rowIndex - 1] = row;
  dropObj_(name);
  touchFor_(name);
}

/** 행 완전 삭제 (한 줄) */
function deleteRow_(name, rowIndex) {
  deleteRows_(name, [rowIndex]);
}

/**
 * 여러 행 삭제 — 이어진 구간끼리 묶어서 한 번에 지운다.
 * 한 줄씩 지우면 줄 수만큼 느려진다.
 */
function deleteRows_(name, rowIndexes) {
  if (!rowIndexes || !rowIndexes.length) return;
  var sh = sheet_(name);
  var rows = rowIndexes.slice().sort(function (a, b) { return b - a; });  // 아래에서부터

  /* ★ 지우기도 잠금 안에서 (v54). 줄을 지우면 아래 줄 번호가 전부 당겨지는데,
     그 사이에 다른 사람이 줄을 붙이면 엉뚱한 자리에 들어간다. */
  withLock_(function () {
    var _t0 = new Date().getTime();
    var i = 0;
    while (i < rows.length) {
      var end = rows[i];      // 큰 번호
      var start = end;
      while (i + 1 < rows.length && rows[i + 1] === start - 1) { start = rows[i + 1]; i++; }
      sh.deleteRows(start, end - start + 1);
      i++;
    }
    SpreadsheetApp.flush();
    add_('행삭제:' + name, _t0);
  });
  delete _VALS[name];
  delete _HEAD[name];
  dropObj_(name);
  touchFor_(name);
}

/** 같은 시트에 여러 줄을 한 번에 추가 (쓰기 1회, 읽기 0회) */
function appendObjects_(name, list) {
  if (!list || !list.length) return;
  var sh = sheet_(name);
  if (!sh) return;
  var head = headFast_(name);
  if (!head.length) return;

  var rows = list.map(function (obj) {
    var row = [];
    for (var i = 0; i < head.length; i++) {
      var v = obj[head[i]];
      row.push(v === undefined || v === null ? '' : v);
    }
    return row;
  });
  /* 한 줄짜리(appendObject_)와 같은 이유로 잠금 안에서 자리를 정하고 쓴다 (v54).
     여러 줄이어도 setValues 한 번이라 잠금을 잡고 있는 시간은 거의 같다. */
  withLock_(function () {
    var at = appendAt_(name, sh);
    var _t0 = new Date().getTime();
    sh.getRange(at, 1, rows.length, head.length).setValues(rows);
    SpreadsheetApp.flush();
    add_('쓰기:' + name, _t0);
  });
  if (_VALS[name] && _VALS[name].length) {
    rows.forEach(function (r) { _VALS[name].push(r); });
  }
  dropObj_(name);
  touchFor_(name);
}

/** 설정 읽기 / 쓰기 */
function settings_() {
  var rows = readObjects_('설정');
  var o = {};
  for (var i = 0; i < rows.length; i++) {
    var k = rows[i]['키'];
    if (!k) continue;
    var v = rows[i]['값'];
    // 날짜로 변해버린 값도 반드시 글자로 내보낸다
    var sv = (v instanceof Date) ? fmtDT_(v) : String(v == null ? '' : v);
    // 같은 키가 여러 줄이면 값이 들어있는 줄을 우선한다 (빈 줄이 이기지 못하게)
    if (o[k] === undefined || (String(o[k]).trim() === '' && sv.trim() !== '')) o[k] = sv;
  }
  return o;
}

/** 설정 시트에 같은 키가 여러 줄 생겼으면 빈 줄을 정리 */
function cleanupSettings_() {
  var rows = readObjects_('설정');
  var best = {};   // 키 -> 남길 행번호
  var drop = [];
  rows.forEach(function (r) {
    var k = r['키'];
    if (!k) return;
    var has = String(r['값'] == null ? '' : r['값']).trim() !== '';
    if (best[k] === undefined) { best[k] = { row: r._row, has: has }; return; }
    if (has && !best[k].has) { drop.push(best[k].row); best[k] = { row: r._row, has: has }; }
    else { drop.push(r._row); }
  });
  if (drop.length) deleteRows_('설정', drop);
  return drop.length;
}

function setSetting_(key, val) {
  var sh = sheet_('설정');
  var rows = readObjects_('설정');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['키'] === key) {
      sh.getRange(rows[i]._row, 2).setValue(val);
      var vals = values_('설정');
      if (vals[rows[i]._row - 1]) vals[rows[i]._row - 1][1] = val;
      dropObj_('설정');
      return;
    }
  }
  appendObject_('설정', { '키': key, '값': val, '설명': '' });
}

function ensureSettings_() {
  var sh = sheet_('설정');
  if (!sh) return;
  var have = {};
  var rows = readObjects_('설정');
  for (var i = 0; i < rows.length; i++) have[rows[i]['키']] = true;
  var add = [];
  for (var j = 0; j < DEFAULT_SETTINGS.length; j++) {
    if (!have[DEFAULT_SETTINGS[j][0]]) add.push(DEFAULT_SETTINGS[j]);
  }
  if (add.length) {
    var start = values_('설정').length + 1;
    sh.getRange(start, 1, add.length, 3).setValues(add);
    delete _VALS['설정']; delete _OBJ['설정'];
    bumpSheet_('설정');                 // 담아둔 캐시도 버린다 (v39)
  }
}

/**
 * 마지막 변경 시각.
 * 시트에 쓰면 저장할 때마다 쓰기가 한 번 더 늘어나므로 빠른 저장소를 쓴다.
 */
/** 시트에 쓴 뒤 바뀜 시각을 올린다. 단 '보기만 한 기록'(읽음·로그)은 올리지 않는다 (v43) */
function touchFor_(name) {
  if (name && QUIET_SHEETS[name]) return;
  touch_();
}

function touch_() {
  if (_TOUCHED) return;   // 요청당 1번이면 충분하다
  _TOUCHED = true;
  var v = String(new Date().getTime());
  var t0 = new Date().getTime();
  try {
    PropertiesService.getScriptProperties().setProperty('LAST_UPDATE', v);
  } catch (e) {}
  add_('속성:바뀜시각쓰기', t0);
  // 이번 요청에서 다시 물어보지 않아도 되게 손에 들고 있는 값도 갱신한다 (v40)
  _LASTUP = v;
  if (_VER) _VER['LAST_UPDATE'] = v;
}

/** 이 요청을 처리하는 데 걸린 밀리초 */
function took_() { return new Date().getTime() - _START; }

/* -------------------------------------------------------------
 *  기준정보(법인·업무유형·문서양식·설정·현장목록)
 *  거의 바뀌지 않으므로 구글 서버 캐시에 6시간 담아둔다.
 *  바뀌면 버전 번호를 올려서 캐시를 자동으로 버린다.
 * ----------------------------------------------------------- */
/* ★ 속성은 요청당 한 번만 읽는다 (v40).
   verAll_() 의 getProperties() 가 이미 **속성 전부**를 가져온다.
   META_VER 도 LAST_UPDATE 도 그 안에 들어 있으므로 따로 물을 이유가 없다.
   v39 측정에서 번호표 43ms + meta버전 43ms + 바뀜시각 47ms 로 세 번 묻고 있었다. */
function metaVer_() {
  return String(verAll_()['META_VER'] || '1');
}

function bumpMeta_() {
  var v = String(new Date().getTime());
  try {
    PropertiesService.getScriptProperties().setProperty('META_VER', v);
  } catch (e) {}
  _META = null;
  // 손에 들고 있던 옛 기준정보도 같이 버린다 (v40)
  if (_VER) _VER['META_VER'] = v;
  if (_CGOT) delete _CGOT['@meta'];
}

function meta_() {
  if (_META) { hit_('기준정보'); return _META; }
  var key = 'META_' + metaVer_();

  // 시트와 같이 한 번에 가져온 것에서 먼저 찾는다 (왕복 0회)
  var tc = new Date().getTime();
  var raw = cachePrefetch_()['@meta'];
  // 시트 캐시를 꺼둔 상태에서도 기준정보 캐시는 살아 있어야 한다
  if (!raw && !SHEET_CACHE_ON) {
    try { raw = CacheService.getScriptCache().get(key); } catch (e) {}
  }
  if (raw) {
    try {
      _META = JSON.parse(raw);
      add_('캐시:기준정보(적중)', tc);
      return _META;
    } catch (e) {}
  }

  var t0 = new Date().getTime();
  _META = buildMeta_();
  add_('단계:기준정보재생성(빗나감)', t0);
  var tp = new Date().getTime();
  try { CacheService.getScriptCache().put(key, JSON.stringify(_META), CACHE_SEC); } catch (e) {}
  add_('캐시:기준정보쓰기', tp);
  return _META;
}

function buildMeta_() {
  var corps = readObjects_('법인')
    .filter(function (r) { return r['법인코드'] && r['사용여부'] !== 'N'; })
    .map(function (r) { return { code: r['법인코드'], name: r['법인명'] }; });

  /* types    = 지금 고를 수 있는 유형 (등록 창의 버튼)
     typeAll  = 이름을 붙이는 데 쓰는 전체 목록 (사용 안 하는 유형 포함)
     ★ 총무처럼 그만 쓰기로 한 유형도 **이미 등록된 업무가 있다.**
       typeAll 이 없으면 그 업무의 유형이 'GA' 라는 코드로 보인다 (v44). */
  var typeRows = readObjects_('업무유형').filter(function (r) { return r['유형코드']; });
  var types = typeRows
    .filter(function (r) { return r['사용여부'] !== 'N'; })
    .map(function (r) { return { code: r['유형코드'], name: r['유형명'], form: r['추가양식'] }; });
  var typeAll = typeRows
    .map(function (r) {
      return { code: r['유형코드'], name: r['유형명'], form: r['추가양식'],
               off: r['사용여부'] === 'N' };
    });

  var fields = {};
  readObjects_('양식항목').forEach(function (r) {
    var c = r['양식코드'];
    if (!c || !r['항목명']) return;
    if (!fields[c]) fields[c] = [];
    fields[c].push({
      name: String(r['항목명']),
      kind: String(r['입력형태'] || '글'),
      req: String(r['필수'] || '') === 'Y',
      opts: String(r['선택지'] || '').split(',').map(function (x) { return x.trim(); })
        .filter(function (x) { return x; }),
      help: String(r['안내문'] || ''),
      seq: Number(r['순번'] || 99)
    });
  });
  Object.keys(fields).forEach(function (k) {
    fields[k].sort(function (a, b) { return a.seq - b.seq; });
  });

  var forms = {};
  var formList = [];
  var dedup = {};                        // 같은 양식코드가 두 줄 있어도 목록엔 한 번만
  readObjects_('문서양식')
    .filter(function (f) {
      var c = String(f['양식코드'] || '').trim();
      if (!c || f['사용여부'] === 'N') return false;
      if (dedup[c]) return false;
      dedup[c] = true;
      return true;
    })
    .sort(function (a, b) { return Number(a['표시순서'] || 99) - Number(b['표시순서'] || 99); })
    .forEach(function (f) {
      var c = f['양식코드'];
      forms[c] = {
        code: c, name: f['양식명'],
        approvers: String(f['기본승인자'] || ''), viewers: String(f['기본열람자'] || ''),
        useItems: String(f['내역사용'] || 'Y') !== 'N',
        needReceipt: String(f['영수증필수'] || '') === 'Y',
        itemsTitle: String(f['내역제목'] || '내역'),
        fields: fields[c] || []
      };
      formList.push(forms[c]);
    });

  var sites = readObjects_('연동캐시')
    .filter(function (r) { return r['구분'] === '견적'; })
    .map(function (r) { return { code: r['키'], name: r['값1'], addr: r['값2'], state: r['값3'] }; });

  return { corps: corps, types: types, typeAll: typeAll, forms: forms, formList: formList,
           sites: sites, settings: settings_(), ver: metaVer_() };
}

/** 새 번호 채번: PREFIX-YYMMDD-001 */
/**
 * 새 번호 채번: PREFIX-YYMMDD-001
 * 오늘 것은 항상 시트 맨 아래쪽에 있으므로 뒤에서부터 훑는다.
 * 뒤 400줄에서 오늘 것을 하나도 못 찾으면 그때만 전체를 훑는다.
 */
/**
 * 오늘 날짜로 다음 번호를 만든다.  W-260830-003 처럼.
 *
 * ★★ 번호를 스크립트 속성에 '예약' 한다 (v54).
 *   예전에는 시트에서 최대값을 찾아 +1 만 했습니다. 두 사람이 같은 순간에 저장하면
 *   둘 다 같은 최대값을 보고 **같은 번호를 받았습니다** (문서번호가 두 건).
 *   현장견적의 issueEstimateCode_ 가 쓰던 방식(속성에 순번을 남겨 두기)을
 *   그대로 가져왔습니다. 새로 설계하지 않았습니다.
 *
 *   시트를 훑는 무거운 일은 **잠금 밖에서** 미리 해둡니다.
 *   잠금 안에서는 속성을 읽고 하나 올려 쓰는 것뿐이라 아주 짧습니다.
 *
 * ★ 속성 칸은 열 이름마다 하나뿐입니다 (SEQ_업무ID = 'W-260830-|3').
 *   날짜마다 새 칸을 만들면 속성이 끝없이 쌓이고, verAll_() 이 매 요청마다
 *   그것을 전부 읽어 오므로 앱 전체가 느려집니다.
 *
 * ★ 여기서만 속성을 따로 읽습니다. 잠금 안에서는 지금 값이어야 하기 때문입니다
 *   (요청 처음에 읽어둔 verAll_() 값은 이미 낡았을 수 있습니다).
 *   저장할 때만 도는 길이라 board_ 같은 읽기 경로는 느려지지 않습니다.
 */
function nextId_(sheetName, colName, prefix) {
  var head = prefix + '-' + stamp_() + '-';
  var fromSheet = maxSeqInSheet_(sheetName, colName, head);   // 잠금 밖에서 (무거운 일)

  return withLock_(function () {
    var key = 'SEQ_' + colName;
    var props = PropertiesService.getScriptProperties();
    var raw = String(props.getProperty(key) || '');            // 'W-260830-|3'
    var saved = 0;
    var bar = raw.indexOf('|');
    if (bar > 0 && raw.substring(0, bar) === head) {
      saved = Number(raw.substring(bar + 1)) || 0;             // 오늘 것일 때만 이어간다
    }

    var n = Math.max(saved, fromSheet) + 1;
    props.setProperty(key, head + '|' + n);

    var seq = String(n);
    while (seq.length < 3) seq = '0' + seq;
    return head + seq;
  });
}

/** 시트에 이미 들어 있는 오늘 번호 중 가장 큰 순번 (속성이 지워져도 겹치지 않게 하는 안전장치) */
function maxSeqInSheet_(sheetName, colName, head) {
  var rows = readObjects_(sheetName);
  var max = 0, found = false;

  var stop = Math.max(0, rows.length - 400);
  for (var i = rows.length - 1; i >= stop; i--) {
    var v = String(rows[i][colName] || '');
    if (v.indexOf(head) !== 0) continue;
    found = true;
    var n = parseInt(v.substring(head.length), 10);
    if (n > max) max = n;
  }
  if (!found && stop > 0) {
    for (var j = stop - 1; j >= 0; j--) {
      var v2 = String(rows[j][colName] || '');
      if (v2.indexOf(head) !== 0) continue;
      var n2 = parseInt(v2.substring(head.length), 10);
      if (n2 > max) max = n2;
    }
  }
  return max;
}

function log_(phone, action, targetId, token, result) {
  try {
    appendObject_('로그', {
      '일시': fmtDT_(now_()), '행위자전화': phone, '행위': action,
      '대상ID': targetId || '', '기기토큰': token || '', '결과': result || 'OK'
    });
  } catch (e) {}
}

// =============================================================
//  인증
// =============================================================

/** 시트에 없는 열을 자동으로 추가하고 열 번호를 돌려줌 */
function ensureColumn_(sheetName, colName) {
  var sh = sheet_(sheetName);
  if (!sh) return -1;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (var i = 0; i < head.length; i++) {
    if (String(head[i]) === colName) return i + 1;
  }
  var idx = head.length + 1;
  sh.getRange(1, idx).setValue(colName).setFontWeight('bold').setBackground('#F1F3F4');
  sh.setColumnWidth(idx, 130);
  // 열이 늘었으니 이번 요청의 캐시는 버린다 (안 그러면 한 줄을 짧게 쓴다)
  delete _VALS[sheetName]; delete _OBJ[sheetName];
  delete _HEAD[sheetName];
  bumpSheet_(sheetName);              // 담아둔 캐시도 버린다 (v39)
  return idx;
}

/** PIN을 되돌릴 수 없는 형태로 바꿔 저장 (시트에 숫자 그대로 남지 않게) */
function hashPin_(phone, pin) {
  var raw = SALT + '|' + normPhone_(phone) + '|' + String(pin);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function findUserByToken_(token) {
  if (!token) return null;
  var rows = readObjects_('직원');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['재직상태'] === '퇴사') continue;
    if (rows[i]['재직상태'] === '승인대기') continue;   // 승인 전에는 기기를 기억해도 못 들어온다
    var list = String(rows[i]['기기토큰'] || '').split(',');
    for (var j = 0; j < list.length; j++) {
      if (list[j].trim() && list[j].trim() === token) return rows[i];
    }
  }
  return null;
}

function findUserByPhone_(phone) {
  var p = normPhone_(phone);
  var rows = readObjects_('직원');
  for (var i = 0; i < rows.length; i++) {
    if (normPhone_(rows[i]['전화번호']) === p) return rows[i];
  }
  return null;
}

function userInfo_(u) {
  if (!u) return null;
  return {
    phone: normPhone_(u['전화번호']),
    name: u['이름'],
    dept: u['부서'] || '',
    rank: u['직급'] || '',
    grade: Number(u['권한등급'] || 1)
  };
}

function requireUser_(token) {
  var u = findUserByToken_(token);
  if (!u) throw new Error('NOAUTH');
  return u;
}

// =============================================================
//  API - 시작 / 로그인
// =============================================================

/**
 * 첫 진입 전용 — 기준정보와 진행판 데이터를 한 번에 돌려준다.
 * (예전에는 api_boot → api_board 를 연달아 불러서 왕복이 2번이었다)
 */
function api_start(token, corp) {
  var _t = new Date().getTime();
  var m = meta_();
  add_('단계:기준정보', _t);
  var st = m.settings;
  var base = {
    company: st['회사명'] || 'UNION ONE',
    version: st['앱버전'] || 'v1.0',
    code: SETUP_VER,                     // 서버에 실제로 올라간 코드 버전
    fontTitle: st['폰트URL_제목'] || '',
    fontNum: st['폰트URL_숫자'] || '',
    corps: m.corps, types: m.types, typeAll: m.typeAll,
    sites: m.sites, forms: m.formList, ver: m.ver
  };

  _t = new Date().getTime();
  var u = findUserByToken_(token);
  add_('단계:본인찾기', _t);
  if (!u) {
    logTiming_('api_start(로그인필요)');
    return { ok: false, need: 'login', meta: base, ms: took_(), t: timing_() };
  }

  var me = userInfo_(u);
  _t = new Date().getTime();
  var b = board_(me, corp);
  add_('합계:board_', _t);
  b.meta = base;

  /* 최근접속 기록 (쓰기는 응답을 다 만든 뒤에).
     ★ 사람마다 1시간에 한 번만 쓴다 (v40).
       이 열은 코드 어디에서도 읽지 않는다 — 시트에서 관리자가 눈으로 보는 용도다.
       그런데 여기서 '직원' 시트에 쓰면 직원 번호표가 바뀌어
       **다른 직원 5명의 캐시까지 한꺼번에 무효**가 된다.
       6명이 아침에 차례로 들어오면 서로의 캐시를 계속 깨뜨렸다 (v39 측정 354ms). */
  _t = new Date().getTime();
  if (dueFor_('SEEN_' + me.phone, 60 * 60 * 1000)) {
    try { updateObject_('직원', u._row, { '최근접속일시': fmtDT_(now_()) }); } catch (e) {}
    add_('단계:최근접속쓰기', _t);
  }

  b.ms = took_();
  b.t = timing_();
  logTiming_('api_start');
  return b;
}

function api_boot(token) {
  // 설정 점검은 화면을 불러올 때(doGet) 이미 끝났으므로 여기서 다시 하지 않는다
  var m = meta_();
  var st = m.settings;
  var base = {
    company: st['회사명'] || 'UNION ONE',
    version: st['앱버전'] || 'v1.0',
    fontTitle: st['폰트URL_제목'] || '',
    fontNum: st['폰트URL_숫자'] || '',
    corps: m.corps,
    types: m.types,
    sites: m.sites,
    forms: m.formList,
    ver: m.ver
  };

  var u = findUserByToken_(token);
  if (!u) return { ok: false, need: 'login', meta: base };

  updateObject_('직원', u._row, { '최근접속일시': fmtDT_(now_()) });
  return { ok: true, me: userInfo_(u), meta: base };
}

/** 1단계: 번호 확인 — 등록된 번호인지, PIN을 이미 만들었는지 */
function api_checkPhone(phone) {
  ensureColumn_('직원', 'PIN해시');
  ensureSyncSheet_();
  var u = findUserByPhone_(phone);

  /* ★ 왜 안 되는지 code 로 구분해서 보냅니다.
     화면은 이 code 를 보고 '사용 신청' 버튼을 띄웁니다.
     예전에는 code 를 보내지 않아 버튼이 한 번도 뜨지 못했고,
     처음 쓰는 사람은 '문의해주세요' 에서 길이 끊겼습니다 (2026-08-28). */
  if (!u) {
    return { ok: false, code: 'NOT_FOUND',
             msg: '등록되지 않은 번호입니다. 아래에서 사용 신청을 해주세요.' };
  }

  var st = String(u['재직상태'] || '재직');
  if (st === '승인대기') {
    return { ok: false, code: 'PENDING',
             msg: '신청이 접수되어 있습니다. 관리자 승인 후 이용하실 수 있습니다.' };
  }
  if (st === '퇴사') {
    return { ok: false, code: 'LEFT',
             msg: '사용할 수 없는 계정입니다. 전략기획실에 문의해주세요.' };
  }
  return { ok: true, name: u['이름'], hasPin: !!String(u['PIN해시'] || '').trim() };
}

/** 2단계: PIN 확인 후 이 기기 등록 */
function api_login(phone, pin, token) {
  ensureColumn_('직원', 'PIN해시');
  ensureSyncSheet_();
  var u = findUserByPhone_(phone);
  if (!u) return { ok: false, msg: '등록되지 않은 번호입니다.' };

  /* ★ 승인 전에는 PIN 이 맞아도 들여보내지 않습니다.
     신청할 때 PIN 을 이미 만들어 두기 때문에 여기서 막지 않으면
     승인을 기다리지 않고 그대로 들어옵니다. */
  var state = String(u['재직상태'] || '재직');
  if (state === '승인대기') {
    return { ok: false, msg: '아직 승인 전입니다. 관리자 승인 후 이용하실 수 있습니다.' };
  }
  if (state === '퇴사') return { ok: false, msg: '사용할 수 없는 계정입니다.' };

  var p = String(pin || '').replace(/[^0-9]/g, '');
  if (p.length !== 4) return { ok: false, msg: 'PIN 4자리를 입력해주세요.' };

  var saved = String(u['PIN해시'] || '').trim();
  var upd = { '전화번호': normPhone_(u['전화번호']), '최근접속일시': fmtDT_(now_()) };

  if (!saved) {
    // 최초 로그인: 입력한 PIN을 그대로 등록
    upd['PIN해시'] = hashPin_(u['전화번호'], p);
  } else {
    if (hashPin_(u['전화번호'], p) !== saved) {
      log_(normPhone_(u['전화번호']), '로그인실패', '', token, 'PIN불일치');
      // 화면의 상시 안내문을 없앴으므로 되찾는 길을 오류 메시지에 담는다
      return { ok: false, msg: 'PIN이 맞지 않습니다. 잊으셨으면 전략기획실에 초기화를 요청해주세요.' };
    }
  }

  // 기기 등록 (여러 기기 허용, 최대 5대)
  var list = String(u['기기토큰'] || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
  if (list.indexOf(token) < 0) list.push(token);
  if (list.length > 5) list = list.slice(list.length - 5);
  upd['기기토큰'] = list.join(',');

  updateObject_('직원', u._row, upd);
  log_(normPhone_(u['전화번호']), saved ? '로그인' : 'PIN등록', '', token, 'OK');
  return { ok: true, me: userInfo_(u) };
}

/** 본인 PIN 변경 */
function api_changePin(token, oldPin, newPin) {
  var u = requireUser_(token);
  var p = String(newPin || '').replace(/[^0-9]/g, '');
  if (p.length !== 4) return { ok: false, msg: '새 PIN 4자리를 입력해주세요.' };
  var saved = String(u['PIN해시'] || '').trim();
  if (saved && hashPin_(u['전화번호'], String(oldPin || '')) !== saved) {
    return { ok: false, msg: '현재 PIN이 맞지 않습니다.' };
  }
  updateObject_('직원', u._row, { 'PIN해시': hashPin_(u['전화번호'], p) });
  log_(normPhone_(u['전화번호']), 'PIN변경', '', token, 'OK');
  return { ok: true };
}

/** 관리자: 직원 PIN 초기화 (다음 로그인 때 새로 설정하게 됨) */
function api_resetPin(token, phone) {
  var me = userInfo_(requireUser_(token));
  if (me.grade < 9) return { ok: false, msg: '관리자만 초기화할 수 있습니다.' };
  var u = findUserByPhone_(phone);
  if (!u) return { ok: false, msg: '직원을 찾을 수 없습니다.' };
  updateObject_('직원', u._row, { 'PIN해시': '', '기기토큰': '' });
  log_(me.phone, 'PIN초기화', normPhone_(phone), token, 'OK');
  return { ok: true };
}

/** 이 기기만 로그아웃 */
function api_logout(token) {
  var u = findUserByToken_(token);
  if (!u) return { ok: true };
  var list = String(u['기기토큰'] || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s && s !== token; });
  updateObject_('직원', u._row, { '기기토큰': list.join(',') });
  return { ok: true };
}

/**
 * 마지막 변경 시각 (스크립트 속성 한 칸). 시트는 한 장도 열지 않는다.
 * 30초/60초마다 도는 호출이라 여기서 시트를 읽으면 앱 전체가 느려진다.
 */
function lastUpdate_() {
  // 이번 요청에서 이미 쓴 적이 있으면 그 값이 맞다 (속성을 다시 묻지 않는다)
  if (_TOUCHED && _LASTUP) return _LASTUP;

  /* 속성 전부를 가져오는 verAll_() 안에 LAST_UPDATE 도 들어 있다 (v40).
     단, api_lastUpdate 처럼 시트를 한 장도 안 보는 호출에서는
     속성 전부를 가져오는 것이나 한 칸만 가져오는 것이나 값이 비슷하므로 그냥 이걸 쓴다. */
  return String(verAll_()['LAST_UPDATE'] || '');
}

function api_lastUpdate() {
  var v = lastUpdate_();
  // 이 호출이 서버에서 실제로 몇 ms 인지 실행 기록에 남긴다.
  // (실행 기록의 '기간' 은 이 시간 + 구글 쪽 호출 준비시간이다)
  logTiming_('api_lastUpdate');
  return v;
}

// =============================================================
//  외부 앱 연동 — 실시간 조회 대신 '미리 복사해두기'
//  (남의 스프레드시트를 여는 건 1~2초짜리 작업이라
//   화면을 그릴 때마다 열면 앱 전체가 느려진다)
// =============================================================

function ensureSyncSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName('연동캐시');
  if (sh) return sh;
  sh = ss.insertSheet('연동캐시');
  sh.getRange(1, 1, 1, 6).setValues([['구분', '키', '값1', '값2', '값3', '갱신일시']])
    .setFontWeight('bold').setBackground('#F1F3F4');
  sh.setFrozenRows(1);
  delete _VALS['연동캐시']; delete _OBJ['연동캐시'];
  return sh;
}

/** 연동캐시에서 한 구분을 통째로 갈아끼움 (구간 삭제 + 일괄 쓰기) */
function replaceSync_(kind, rows) {
  ensureSyncSheet_();
  var old = readObjects_('연동캐시')
    .filter(function (r) { return r['구분'] === kind; })
    .map(function (r) { return r._row; });
  if (old.length) deleteRows_('연동캐시', old);

  if (!rows.length) return;
  var nowS = fmtDT_(now_());

  // 이 시트는 전부 글자로 다룬다 (시트가 숫자·날짜로 바꿔버리면 매칭이 깨진다)
  var sh2 = sheet_('연동캐시');
  var startRow = values_('연동캐시').length + 1;
  sh2.getRange(startRow, 1, rows.length, 6).setNumberFormat('@');

  appendObjects_('연동캐시', rows.map(function (r) {
    return {
      '구분': kind, '키': String(r.k), '값1': String(r.v1 == null ? '' : r.v1),
      '값2': String(r.v2 == null ? '' : r.v2), '값3': String(r.v3 == null ? '' : r.v3),
      '갱신일시': nowS
    };
  }));
}

/** 시트 이름을 잘못 넣었을 때를 대비해 머리글로도 찾아준다 */
function findSheetByHeader_(ss, preferName, mustHave) {
  if (preferName) {
    var s1 = ss.getSheetByName(preferName);
    if (s1) return s1;
  }
  var list = ss.getSheets();
  for (var i = 0; i < list.length; i++) {
    if (list[i].getLastColumn() < 1) continue;
    var head = list[i].getRange(1, 1, 1, list[i].getLastColumn()).getValues()[0].join('|');
    var ok = true;
    for (var j = 0; j < mustHave.length; j++) {
      if (head.indexOf(mustHave[j]) < 0) { ok = false; break; }
    }
    if (ok) return list[i];
  }
  return null;
}

/** 출퇴근앱 → 연동캐시 (오늘 기록만) */
function syncAttendance_() {
  var st = settings_();
  var id = String(st['출퇴근시트ID'] || '').trim();
  if (!id) return { ok: false, msg: '출퇴근 스프레드시트 ID가 비어 있습니다.' };

  var ss, sh;
  var _t = new Date().getTime();
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, msg: '출퇴근 스프레드시트를 열 수 없습니다. ID를 확인해주세요.' }; }
  add_('열기:출퇴근앱', _t);

  _t = new Date().getTime();
  sh = findSheetByHeader_(ss, String(st['출퇴근시트명'] || '출퇴근'), ['전화번호', '출근']);
  add_('단계:출퇴근시트찾기', _t);
  if (!sh) return { ok: false, msg: '출퇴근 기록 시트를 찾지 못했습니다.' };

  var last = sh.getLastRow();
  if (last < 2) { replaceSync_('출퇴근', []); attPut_([]); return { ok: true, count: 0 }; }

  // ★ 최근 400줄만 실제로 읽는다 (v39). 예전에는 from 을 계산해놓고
  //   getRange(1,1,last,...) 로 시트를 통째로 읽고 있었다 (v37 측정 761ms).
  var got = outerTail_(sh, 400, '출퇴근앱');
  var head = got.head, body = got.body, from = got.from;

  var iP = -1, iD = -1, iIn = -1, iOut = -1;
  for (var c = 0; c < head.length; c++) {
    var h = String(head[c]);
    if (iP < 0 && h.indexOf('전화') >= 0) iP = c;
    if (iD < 0 && (h.indexOf('일자') >= 0 || h.indexOf('날짜') >= 0)) iD = c;
    if (iIn < 0 && h.indexOf('출근시간') >= 0) iIn = c;
    if (iOut < 0 && h.indexOf('퇴근시간') >= 0) iOut = c;
  }
  if (iIn < 0) for (var c2 = 0; c2 < head.length; c2++) if (String(head[c2]).indexOf('출근') >= 0) { iIn = c2; break; }
  if (iP < 0 || iD < 0) return { ok: false, msg: '전화번호 또는 일자 열을 찾지 못했습니다.' };

  var td = today_();
  var rows = [];
  var seen = {};
  for (var r = 0; r < body.length; r++) {
    if (fmtD_(body[r][iD]) !== td) continue;
    var ph = normPhone_(body[r][iP]);
    if (!ph || seen[ph]) continue;
    seen[ph] = true;
    rows.push({
      k: ph,
      v1: iIn >= 0 ? fmtT_(body[r][iIn]) : '',
      v2: iOut >= 0 ? fmtT_(body[r][iOut]) : '',
      v3: td
    });
  }
  replaceSync_('출퇴근', rows);
  attPut_(rows);                       // 캐시에도 담는다 (읽을 때 캐시를 먼저 본다)
  return { ok: true, count: rows.length, from: from };
}

/**
 * 남의 스프레드시트에서 **머리글 + 뒤쪽 n줄만** 읽는다.
 * 아직 n줄을 안 넘었으면 통째로 한 번에 읽는다 (왕복 1번이 줄 수보다 비싸다).
 */
function outerTail_(sh, n, label) {
  var last = sh.getLastRow(), lc = sh.getLastColumn();
  _TN[label] = { rows: last - 1, cols: lc };

  var t0 = new Date().getTime();
  if (last - 1 <= n) {
    var all = sh.getRange(1, 1, last, lc).getValues();
    add_('시트:' + label + '(전체)', t0);
    return { head: all[0], body: all.slice(1), from: 2 };
  }
  var head = sh.getRange(1, 1, 1, lc).getValues()[0];
  var from = last - n + 1;
  var body = sh.getRange(from, 1, last - from + 1, lc).getValues();
  add_('시트:' + label + '(꼬리' + n + ')', t0);
  return { head: head, body: body, from: from };
}

/* 출퇴근 현황을 캐시에도 담아둔다 (v39).
   ★ 연동캐시 시트 쓰기를 없애지 않는다 — 캐시는 구글이 임의로 비운다.
   시트가 최종 보관소이고 캐시는 빠른 길일 뿐이다. */
function attKey_() { return 'ATT|' + today_(); }

function attPut_(rows) {
  try {
    CacheService.getScriptCache().put(attKey_(), JSON.stringify(rows || []), CACHE_SEC);
  } catch (e) {}
}

function attGet_() {
  // 시트·기준정보와 함께 이미 한 번에 가져와 있다 (v41). 따로 묻지 않는다.
  var s = cachePrefetch_()['@att'];
  if (!s && !SHEET_CACHE_ON) {
    try { s = CacheService.getScriptCache().get(attKey_()); } catch (e) {}
  }
  if (!s) return null;
  try { return JSON.parse(s); } catch (e) { return null; }
}

/** 현장견적앱 → 연동캐시 (현장 목록) */
function syncEstimates_() {
  var st = settings_();
  var id = String(st['견적시트ID'] || '').trim();
  if (!id) return { ok: false, msg: '현장견적 스프레드시트 ID가 비어 있습니다.' };

  var ss;
  var _t = new Date().getTime();
  try { ss = SpreadsheetApp.openById(id); }
  catch (e) { return { ok: false, msg: '현장견적 스프레드시트를 열 수 없습니다.' }; }
  add_('열기:견적앱', _t);

  _t = new Date().getTime();
  var sh = findSheetByHeader_(ss, '견적대장', ['견적번호']) ||
           findSheetByHeader_(ss, '견적대장', ['코드번호']);
  add_('단계:견적시트찾기', _t);
  if (!sh) return { ok: false, msg: '견적대장 시트를 찾지 못했습니다.' };

  var last = sh.getLastRow();
  if (last < 2) {
    // 빈 시트도 지문으로 견준다. 이미 비어 있으면 30분마다 헛일하지 않는다.
    var sig0 = estSig_([]);
    if (sig0 === estSigSaved_()) return { ok: true, count: 0, changed: false };
    replaceSync_('견적', []);
    estSigSave_(sig0);
    return { ok: true, count: 0, changed: true };
  }

  // ★ 최근 300줄만 실제로 읽는다 (v39). 예전에는 from 을 계산해놓고 통째로 읽었다.
  var got = outerTail_(sh, 300, '견적앱');
  var head = got.head, body = got.body;

  var iNo = -1, iCust = -1, iAddr = -1, iState = -1;
  for (var c = 0; c < head.length; c++) {
    var h = String(head[c]);
    if (iNo < 0 && (h.indexOf('견적번호') >= 0 || h.indexOf('코드번호') >= 0)) iNo = c;
    if (iCust < 0 && (h.indexOf('고객') >= 0 || h.indexOf('상호') >= 0)) iCust = c;
    if (iAddr < 0 && h.indexOf('주소') >= 0) iAddr = c;
    if (iState < 0 && h.indexOf('계약') >= 0) iState = c;
  }
  if (iNo < 0) return { ok: false, msg: '견적번호 열을 찾지 못했습니다.' };

  var rows = [];
  var seen = {};
  for (var r = body.length - 1; r >= 0; r--) {     // 아래(최신)에서부터
    var no = String(body[r][iNo] || '').trim();
    if (!no || seen[no]) continue;
    seen[no] = true;
    rows.push({
      k: no,
      v1: iCust >= 0 ? String(body[r][iCust] || '') : '',
      v2: iAddr >= 0 ? String(body[r][iAddr] || '') : '',
      v3: iState >= 0 ? String(body[r][iState] || '') : ''
    });
    if (rows.length >= 150) break;
  }

  /* ★ 견적 목록이 지난번과 똑같으면 아무것도 하지 않는다 (v38).
     예전에는 30분마다 무조건 시트를 갈아엎고 기준정보 캐시를 버렸다.
     그러면 30분에 한 번, 그 뒤 처음 들어온 사람이 기준정보를 새로 짓느라
     2.2초(v37 측정)를 더 물었다. 견적은 하루에 몇 건 안 바뀐다. */
  var sig = estSig_(rows);
  if (sig && sig === estSigSaved_()) {
    return { ok: true, count: rows.length, changed: false };
  }

  replaceSync_('견적', rows);
  estSigSave_(sig);
  return { ok: true, count: rows.length, changed: true };
}

/** 견적 목록을 짧은 지문 하나로 (통째로 담기엔 길다) */
function estSig_(rows) {
  try {
    var s = rows.map(function (r) {
      return r.k + '|' + r.v1 + '|' + r.v2 + '|' + r.v3;
    }).join('\n');
    var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8);
    return d.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  } catch (e) { return ''; }
}
function estSigSaved_() {
  try { return String(PropertiesService.getScriptProperties().getProperty('EST_SIG') || ''); }
  catch (e) { return ''; }
}
function estSigSave_(sig) {
  if (!sig) return;
  try { PropertiesService.getScriptProperties().setProperty('EST_SIG', sig); } catch (e) {}
}

/* 자동 실행용 (트리거가 부르는 함수) */
/* ★ 출퇴근 동기화는 기준정보(meta)와 아무 상관이 없다.
   여기서 bumpMeta_() 를 부르면 5분마다 6시간짜리 캐시가 버려져서
   그 뒤 첫 접속이 기준정보 6개 시트를 다시 읽는다. 부르지 않는다.
   견적은 meta 의 현장목록을 바꾸므로 그때만 버린다. */
/**
 * 마지막으로 한 지 ms 밀리초가 지났는가.
 * ★ 읽기는 이미 가져와둔 속성 뭉치에서 본다 (v40) — 아직 때가 안 됐으면 왕복 0회다.
 *   때가 됐을 때만 한 번 쓴다.
 */
function dueFor_(key, ms) {
  var now = new Date().getTime();
  var last = Number(verAll_()[key] || 0);
  if (last && (now - last) < ms) return false;
  try { PropertiesService.getScriptProperties().setProperty(key, String(now)); } catch (e) {}
  if (_VER) _VER[key] = String(now);
  return true;
}

/**
 * 5분마다 도는 일.
 *
 * ① 시트 캐시 데우기 — 사람이 차가운 캐시를 만나 3.3초를 무는 일이 없게 한다.
 *    이미 담겨 있으면 아무것도 하지 않는다 (getAll 1번, 약 50ms).
 * ② 출퇴근 가져오기 — **20분에 한 번만.** 우리 스프레드시트에 행삭제+재작성을 하는 작업이라
 *    자주 돌면 다른 사람의 읽기와 부딪힌다 ('통신 오류' 의 배경이었다).
 *
 * ★ 출퇴근 동기화는 기준정보(meta)와 상관이 없다. 여기서 bumpMeta_() 를 부르면
 *   6시간짜리 캐시가 버려져서 그 뒤 첫 접속이 기준정보를 다시 짓는다. 부르지 않는다.
 */
function syncAttendanceJob() {
  try {
    var warmed = warmCache_();
    if (warmed.length) console.log('[캐시] 데움: ' + warmed.join(', '));
  } catch (e) {}
  try {
    if (dueFor_('ATT_AT', 20 * 60 * 1000)) syncAttendance_();
  } catch (e) {}
  logTiming_('syncAttendanceJob');
}

function syncEstimateJob() {
  // 견적 목록이 실제로 바뀌었을 때만 기준정보 캐시를 버린다 (v38)
  try {
    var r = syncEstimates_();
    if (r && r.changed) bumpMeta_();
  } catch (e) {}
  logTiming_('syncEstimateJob');
}

/**
 * ★ 편집기에서 이 함수를 한 번 실행하세요 ★
 *
 * 자동작업 세 가지를 등록합니다.
 *   · 5분마다  — 시트 캐시 데우기 (+ 출퇴근은 20분에 한 번)
 *   · 30분마다 — 견적 가져오기
 *   · 시트가 바뀔 때 — 손으로 고친 값을 앱이 알아채게 (onChange)
 */
function 자동동기화_설치() {
  var 지움 = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'syncAttendanceJob' || f === 'syncEstimateJob' || f === 'onSheetChange') {
      ScriptApp.deleteTrigger(t); 지움++;
    }
  });

  ScriptApp.newTrigger('syncAttendanceJob').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('syncEstimateJob').timeBased().everyMinutes(30).create();

  var 변경트리거 = '등록됨';
  try {
    ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss_()).onChange().create();
  } catch (e) {
    변경트리거 = '등록 실패 (' + String(e && e.message || e) + ')';
  }

  bumpAllSheets_();
  var a = syncAttendance_();
  var b = syncEstimates_();
  bumpMeta_();

  var 지금 = ScriptApp.getProjectTriggers().map(function (t) {
    return '· ' + t.getHandlerFunction();
  }).join('\n');

  var msg = '자동 동기화를 설치했습니다.\n\n' +
    '· 5분마다  캐시 데우기 (출퇴근은 20분에 한 번)\n' +
    '· 30분마다 견적 가져오기\n' +
    '· 시트 변경 감지: ' + 변경트리거 + '\n\n' +
    '옛 트리거 ' + 지움 + '개를 지우고 새로 걸었습니다.\n\n' +
    '지금 걸려 있는 트리거\n' + 지금 + '\n\n' +
    '첫 동기화 결과\n' +
    '· 출퇴근: ' + (a.ok ? a.count + '명' : a.msg) + '\n' +
    '· 견적: ' + (b.ok ? b.count + '건' : b.msg);
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('UNION ONE 워크보드', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

/** 지금 트리거가 몇 개 걸려 있는지 보기만 한다 (아무것도 바꾸지 않음) */
function 트리거_확인() {
  var list = ScriptApp.getProjectTriggers();
  var L = ['지금 걸려 있는 자동작업 ' + list.length + '개', ''];
  list.forEach(function (t) {
    var src = '';
    try { src = String(t.getEventType()); } catch (e) {}
    L.push('· ' + t.getHandlerFunction() + '   (' + src + ')');
  });
  if (!list.length) {
    L.push('(하나도 없습니다)');
    L.push('');
    L.push('편집기에서 [자동동기화_설치] 를 실행하면 다시 걸립니다.');
  } else {
    var have = {};
    list.forEach(function (t) { have[t.getHandlerFunction()] = true; });
    L.push('');
    L.push('· 캐시 데우기(syncAttendanceJob) : ' + (have['syncAttendanceJob'] ? '있음' : '★ 없음'));
    L.push('· 견적(syncEstimateJob)          : ' + (have['syncEstimateJob'] ? '있음' : '★ 없음'));
    L.push('· 시트 변경(onSheetChange)       : ' + (have['onSheetChange'] ? '있음' : '★ 없음'));
    if (!have['syncAttendanceJob'] || !have['syncEstimateJob'] || !have['onSheetChange']) {
      L.push('');
      L.push('★ 없는 것이 있습니다. [자동동기화_설치] 를 한 번 실행해주세요.');
    }
  }
  var msg = L.join('\n');
  Logger.log(msg);
  console.log(msg);
  try { SpreadsheetApp.getUi().alert('자동작업 확인', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

// =============================================================
//  ★ 속도 재기 (편집기에서 실행) ★
//
//  고치기 전에 어디에 시간이 쓰이는지부터 숫자로 본다.
//  편집기에서 [속도_재기] 를 고르고 ▶ 실행 을 누르면
//  창에 표(시트별 줄 수 / 읽는 데 걸린 시간 / 구간별 시간)가 뜬다.
//  아무것도 고치지 않는다. 재기만 한다.
// =============================================================

/** 재기 전 상태 되돌리기 (같은 조건에서 다시 재기 위해). 담아둔 캐시 자체는 건드리지 않는다 */
function 속도_초기화_() {
  _VALS = {}; _HEAD = {}; _OBJ = {};
  _T = {}; _TC = {}; _TH = {}; _TN = {};
  _META = null; _TOUCHED = false; _LASTUP = '';
  _VER = null; _CGOT = null; _CBIG = {};
  // took_() 도 여기서부터 다시 센다. 안 그러면 실행 기록에 남는 로그 한 줄이
  // '속도_재기 전체가 시작된 뒤 흐른 시간' 으로 찍혀 엉뚱하게 커 보인다 (v41)
  _START = new Date().getTime();
}

function ms_(fn) {
  var t0 = new Date().getTime();
  var v = null, err = '';
  try { v = fn(); } catch (e) { err = String(e && e.message || e); }
  return { ms: new Date().getTime() - t0, v: v, err: err };
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}
function padL_(s, n) {
  s = String(s);
  while (s.length < n) s = ' ' + s;
  return s;
}

function 속도_재기() {
  var L = [];
  var line = function (s) { L.push(s); };

  line('■ 어느 스프레드시트를 보고 있나');
  속도_초기화_();
  _SS = null;
  var open = ms_(function () { return ss_(); });
  line('  ' + (open.err ? open.err : ss_().getName()));
  line('  스프레드시트 열기 ' + open.ms + 'ms');
  line('');

  // ---- 1. 시트별 줄 수와 읽는 시간 (한 장씩, 캐시 없이) ----
  var names = ['직원', '업무', '업무일지', '결재문서', '결재선', '결재내역', '문서상세',
               '정산내역', '댓글', '첨부', '게시글', '알림', '로그', '연동캐시',
               '업무상세', '읽음', '설정', '법인', '업무유형', '문서양식', '양식항목',
               '서명', '휴가'];
  line('■ 1. 시트 한 장씩 (캐시를 끄고 시트에서 직접)');
  var 캐시원래 = SHEET_CACHE_ON;
  SHEET_CACHE_ON = false;                    // 이 구간만 캐시를 끄고 잰다
  line('  ' + pad_('시트', 12) + padL_('줄', 7) + padL_('열', 5) + padL_('읽기ms', 9) + padL_('객체ms', 9));
  var readTotal = 0, objTotal = 0;
  var rowsBy = {};
  names.forEach(function (n) {
    속도_초기화_();
    var sh = null;
    try { sh = ss_().getSheetByName(n); } catch (e) {}
    if (!sh) { line('  ' + pad_(n, 12) + '  (없음)'); return; }
    var r = ms_(function () { return values_(n); });
    var o = ms_(function () { return readObjects_(n); });
    var info = _TN[n] || { rows: 0, cols: 0 };
    rowsBy[n] = info.rows;
    readTotal += r.ms; objTotal += o.ms;
    line('  ' + pad_(n, 12) + padL_(info.rows, 7) + padL_(info.cols, 5) +
         padL_(r.ms, 9) + padL_(o.ms, 9));
  });
  line('  ' + pad_('합계', 12) + padL_('', 7) + padL_('', 5) +
       padL_(readTotal, 9) + padL_(objTotal, 9));
  SHEET_CACHE_ON = 캐시원래;                 // 다시 켠다
  line('');

  // ---- 2. 기준정보 캐시 ----
  line('■ 2. 기준정보(meta) 캐시');
  속도_초기화_();
  var warm = ms_(function () { return meta_(); });
  var 적중 = !!_T['캐시:기준정보(적중)'];
  line('  캐시에서 꺼내기      ' + warm.ms + 'ms  ' +
       (적중 ? '(적중)' : '★ 빗나감 — 이 숫자는 새로 지은 시간입니다'));
  line('                       (속성 읽기 + 캐시 한번에읽기 포함)');
  속도_초기화_();
  var cold = ms_(function () { return buildMeta_(); });
  line('  캐시가 없을 때 새로  ' + cold.ms + 'ms');
  line('');

  // ---- 3. api_lastUpdate (30초마다 도는 것) ----
  line('■ 3. api_lastUpdate (앱이 60초마다 부르는 것)');
  속도_초기화_();
  var lu = ms_(function () { return lastUpdate_(); });
  line('  서버 안에서 실제로 하는 일: 스크립트 속성 한 칸 읽기');
  line('  시트 읽기 ' + Object.keys(_TN).length + '장 · ' + lu.ms + 'ms');
  line('  (실행 기록의 "기간" 이 0.5~1.5초로 나오는 것은');
  line('   구글이 호출을 준비하는 고정 비용이고, 우리 코드가 아닙니다)');
  line('');

  // ---- 4. board_ 전체 ----
  속도_초기화_();
  var admin = null;
  readObjects_('직원').forEach(function (r) {
    if (r['재직상태'] === '퇴사') return;
    if (!admin || Number(r['권한등급'] || 1) > Number(admin['권한등급'] || 1)) admin = r;
  });
  if (!admin) {
    line('■ 4. board_ — 직원 시트가 비어 있어 재지 못했습니다');
  } else {
    var me = userInfo_(admin);

    // 먼저 캐시를 끄고 한 번 (예전 방식이 얼마였는지)
    속도_초기화_();
    SHEET_CACHE_ON = false;
    var bdOld = ms_(function () { return board_(me, 'ALL'); });
    SHEET_CACHE_ON = 캐시원래;

    // 캐시를 데운 뒤 다시 (실제로 사람이 겪는 값)
    속도_초기화_();
    warmCache_();
    속도_초기화_();
    var bd = ms_(function () { return board_(me, 'ALL'); });

    line('■ 4. board_ 전체 — ' + me.name + '(등급 ' + me.grade + ') 기준');
    line('  캐시 끄고(예전 방식)  ' + bdOld.ms + 'ms');
    line('  캐시 쓰고(지금)       ' + bd.ms + 'ms' + (bd.err ? ' / 오류: ' + bd.err : ''));
    if (bdOld.ms > 0 && bd.ms > 0) {
      line('  ' + Math.round(bdOld.ms / Math.max(1, bd.ms) * 10) / 10 + '배 빨라졌습니다');
    }
    var size = 0;
    try { size = JSON.stringify(bd.v).length; } catch (e) {}
    line('  브라우저로 보내는 응답 크기 ' + Math.round(size / 1024) + 'KB');
    try {
      var big = {};
      ['tasks', 'docPack', 'logsByTask', 'settle', 'commentsByTask', 'docs',
       'docsByTask', 'notices', 'recent', 'noti', 'attendance'].forEach(function (k) {
        try { big[k] = Math.round(JSON.stringify(bd.v[k] || null).length / 1024); } catch (e) { big[k] = 0; }
      });
      var bk = Object.keys(big).sort(function (a, b) { return big[b] - big[a]; });
      line('  그 중 큰 것: ' + bk.slice(0, 5).map(function (k) {
        return k + ' ' + big[k] + 'KB';
      }).join(' · '));
    } catch (e) {}
    line('');
    line('  구간별');
    var arr = [];
    for (var k in _T) arr.push([k, _T[k]]);
    arr.sort(function (a, b) { return b[1] - a[1]; });
    arr.forEach(function (x) {
      var n = _TC[x[0]] || 1;
      line('  ' + pad_(x[0], 26) + padL_(x[1] + 'ms', 8) + (n > 1 ? '  ×' + n : ''));
    });
    line('');
    line('  캐시가 막아낸 재요청 (0 이면 캐시가 놀고 있는 것)');
    var hk = Object.keys(_TH).sort(function (a, b) { return _TH[b] - _TH[a]; });
    if (!hk.length) line('  (없음)');
    hk.forEach(function (k) { line('  ' + pad_(k, 26) + padL_(_TH[k] + '번', 8)); });

    // ---- 4-2. api_start (앱 첫 진입 한 번에 오는 것) ----
    line('');
    var tok = String(admin['기기토큰'] || '').split(',')[0].trim();
    if (!tok) {
      line('■ 4-2. api_start — 기기토큰이 없어 재지 못했습니다 (앱으로 한 번 로그인하면 생깁니다)');
    } else {
      속도_초기화_();
      warmCache_();
      속도_초기화_();
      var stt = ms_(function () { return api_start(tok, 'ALL'); });
      line('■ 4-2. api_start (앱 첫 진입) — ' + stt.ms + 'ms' + (stt.err ? ' / 오류: ' + stt.err : ''));
      var a2 = [];
      for (var k2b in _T) a2.push([k2b, _T[k2b]]);
      a2.sort(function (a, b) { return b[1] - a[1]; });
      a2.slice(0, 12).forEach(function (x) {
        line('  ' + pad_(x[0], 26) + padL_(x[1] + 'ms', 8));
      });
      line('  (api_start 는 최근접속일시를 쓰므로 직원 시트 번호표가 한 번 바뀝니다)');
    }
  }
  line('');

  // ---- 5. api_settings ----
  line('■ 5. api_settings (설정 화면)');
  속도_초기화_();
  if (admin) {
    var st2 = ms_(function () {
      var raw = settings_();
      var nameOf = nameMap_();
      readObjects_('직원').forEach(function (r) { return nameOf; });
      var s = ss_();
      var info = { name: String(s.getName()), id: String(s.getId()), url: String(s.getUrl()) };
      signMap_(); meta_();
      return [raw, info];
    });
    line('  총 ' + st2.ms + 'ms');
    var arr2 = [];
    for (var k2 in _T) arr2.push([k2, _T[k2]]);
    arr2.sort(function (a, b) { return b[1] - a[1]; });
    arr2.slice(0, 10).forEach(function (x) {
      line('  ' + pad_(x[0], 26) + padL_(x[1] + 'ms', 8));
    });
  }
  line('');

  // ---- 6. 외부 스프레드시트 (5분마다 도는 트리거) ----
  line('■ 6. 외부 연동 (트리거가 5분·30분마다 도는 것)');
  속도_초기화_();
  var at = ms_(function () { return syncAttendance_(); });
  line('  출퇴근 동기화 ' + at.ms + 'ms' +
       (at.v && at.v.ok ? ' (' + at.v.count + '명)' : ' — ' + (at.v ? at.v.msg : at.err)));
  var arr3 = [];
  for (var k3 in _T) arr3.push([k3, _T[k3]]);
  arr3.sort(function (a, b) { return b[1] - a[1]; });
  arr3.slice(0, 6).forEach(function (x) {
    line('  ' + pad_(x[0], 26) + padL_(x[1] + 'ms', 8));
  });

  var msg = L.join('\n');
  Logger.log(msg);
  console.log(msg);
  try {
    SpreadsheetApp.getUi().alert('속도 재기 결과', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
  return msg;
}

// =============================================================
//  시트 값을 캐시에 담는 규칙 (v39)
//
//  ★ cacheEnc_ / cacheDec_ 는 진단용이 아니라 **앱이 늘 쓰는 함수**입니다.
//    values_ 가 이걸로 담고 되살립니다. 지우지 마세요.
//
//  아래 캐시_확인() 은 이 규칙이 값을 하나도 바꾸지 않는지 검사하는 함수입니다.
//  캐시 구조를 고치면 반드시 다시 돌려서 '다른 칸 0개' 인 것을 확인하세요.
// =============================================================

/**
 * 시트 값 → 글자.
 * 날짜는 JSON 이 글자로 바꿔버리므로 표시를 붙여 그대로 되살릴 수 있게 한다.
 * (표시 없이 담으면 2026-08-26 이 '2026-08-26T00:00:00.000Z' 로 굳어버리고,
 *  그 글자를 fmtD_ 가 그대로 자르면 시차 때문에 하루 밀린 날짜가 나온다)
 */
function cacheEnc_(vals) {
  var out = new Array(vals.length);
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i], nr = new Array(row.length);
    for (var j = 0; j < row.length; j++) {
      var v = row[j];
      nr[j] = (v instanceof Date) ? ('\u0000D' + v.getTime()) : v;
    }
    out[i] = nr;
  }
  return JSON.stringify(out);
}

/** 글자 → 시트 값 (날짜는 다시 날짜로) */
function cacheDec_(s) {
  var vals = JSON.parse(s);
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    for (var j = 0; j < row.length; j++) {
      var v = row[j];
      if (typeof v === 'string' && v.length > 2 && v.charCodeAt(0) === 0 && v.charAt(1) === 'D') {
        row[j] = new Date(Number(v.substring(2)));
      }
    }
  }
  return vals;
}

/** 값 하나를 사람이 읽을 수 있게 (형식까지 드러나도록) */
function show_(v) {
  if (v === null || v === undefined) return '(빈칸)';
  if (v instanceof Date) return '날짜:' + Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
  if (v === '') return '(빈칸)';
  return (typeof v) + ':' + String(v);
}

/** 두 값이 완전히 같은가 (형식까지) */
function same_(a, b) {
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    return a.getTime() === b.getTime();
  }
  if (typeof a !== typeof b) return false;
  return a === b;
}

function 캐시_확인() {
  var L = [];
  var line = function (s) { L.push(s); };
  var 다름 = 0, 검사한칸 = 0;

  line('캐시에 담았다가 되살린 값과 지금 시트 값을 견줍니다.');
  line('★ 아무것도 바꾸지 않습니다. 읽기만 합니다.');
  line('');

  // 반드시 시트에서 직접 읽어야 견주는 뜻이 있다. 이 함수가 도는 동안만 캐시를 끈다.
  var 캐시원래 = SHEET_CACHE_ON;
  SHEET_CACHE_ON = false;

  var names = ['직원', '업무', '업무일지', '결재문서', '결재선', '결재내역', '문서상세',
               '정산내역', '댓글', '첨부', '게시글', '알림', '연동캐시', '설정',
               '법인', '업무유형', '문서양식', '양식항목', '읽음', '서명', '휴가',
               '업무상세', '로그'];

  line('■ 1. 시트별 전수 대조');
  line('  ' + pad_('시트', 12) + padL_('칸', 8) + padL_('다른칸', 8) + padL_('캐시KB', 9) + '  100KB한도');
  names.forEach(function (n) {
    속도_초기화_();
    var sh = null;
    try { sh = ss_().getSheetByName(n); } catch (e) {}
    if (!sh) { line('  ' + pad_(n, 12) + '  (시트 없음)'); return; }

    var live = values_(n);
    if (!live.length) { line('  ' + pad_(n, 12) + padL_(0, 8) + padL_(0, 8) + padL_(0, 9)); return; }

    var s = cacheEnc_(live);
    var back = cacheDec_(s);
    var kb = Math.round(s.length / 1024 * 10) / 10;

    var bad = 0, cells = 0, first = [];
    if (back.length !== live.length) {
      bad++; first.push('줄 수가 다름 ' + live.length + ' → ' + back.length);
    }
    for (var i = 0; i < live.length; i++) {
      var a = live[i], b = back[i] || [];
      if (a.length !== b.length) { bad++; first.push((i + 1) + '행 열 수 다름'); continue; }
      for (var j = 0; j < a.length; j++) {
        cells++;
        if (!same_(a[j], b[j])) {
          bad++;
          if (first.length < 8) {
            first.push((i + 1) + '행 ' + (j + 1) + '열  ' + show_(a[j]) + '  →  ' + show_(b[j]));
          }
        }
      }
    }
    검사한칸 += cells; 다름 += bad;
    line('  ' + pad_(n, 12) + padL_(cells, 8) + padL_(bad, 8) + padL_(kb, 9) +
         (s.length > 100000 ? '  ★넘침' : ''));
    first.forEach(function (f) { line('      ' + f); });
  });
  line('');

  // ---- 2. 꼭 확인해야 할 네 가지 ----
  line('■ 2. 날짜 / 전화번호 / 금액 / 진행률');

  var 검사 = [
    { s: '업무',     c: ['시작예정일', '마감일', '완료일', '등록일시'], t: '날짜' },
    { s: '업무일지', c: ['일자', '다음일정일', '작성일시'],             t: '날짜' },
    { s: '정산내역', c: ['일자'],                                       t: '날짜' },
    { s: '직원',     c: ['전화번호', '대리인전화'],                     t: '전화' },
    { s: '업무',     c: ['담당자전화', '협업자전화'],                   t: '전화' },
    { s: '업무',     c: ['계약금액'],                                   t: '금액' },
    { s: '정산내역', c: ['금액'],                                       t: '금액' },
    { s: '업무',     c: ['진행률'],                                     t: '숫자' },
    { s: '업무일지', c: ['진행률', '기공수', '조공수', '폐기물톤수'],   t: '숫자' }
  ];

  검사.forEach(function (chk) {
    속도_초기화_();
    var sh = null;
    try { sh = ss_().getSheetByName(chk.s); } catch (e) {}
    if (!sh) return;
    var live = values_(chk.s);
    if (live.length < 2) { line('  ' + pad_(chk.t + ' ' + chk.s, 20) + '(줄 없음)'); return; }
    var back = cacheDec_(cacheEnc_(live));
    var head = live[0];

    chk.c.forEach(function (col) {
      var ci = -1;
      for (var k = 0; k < head.length; k++) if (String(head[k]) === col) ci = k;
      if (ci < 0) { line('  ' + pad_(chk.t, 5) + pad_(chk.s + '.' + col, 22) + '(열 없음)'); return; }

      var n = 0, bad = 0, 보기 = '';
      for (var i = 1; i < live.length; i++) {
        var a = live[i][ci], b = back[i][ci];
        if (a === '' || a === null || a === undefined) continue;
        n++;
        // 원본 그대로인지 + 앱이 실제로 쓰는 모양(fmtD_/normPhone_/Number)까지 같은지
        var ok = same_(a, b);
        if (ok) {
          if (chk.t === '날짜') ok = (fmtD_(a) === fmtD_(b)) && (fmtDT_(a) === fmtDT_(b));
          else if (chk.t === '전화') ok = (normPhone_(a) === normPhone_(b));
          else if (chk.t === '금액' || chk.t === '숫자') ok = (Number(a || 0) === Number(b || 0));
        }
        if (!ok) { bad++; if (!보기) 보기 = show_(a) + ' → ' + show_(b); }
        else if (!보기 && n === 1) {
          보기 = '예: ' + show_(a) +
                 (chk.t === '날짜' ? '  앱 표시 ' + fmtD_(b) :
                  chk.t === '전화' ? '  앱 표시 ' + normPhone_(b) :
                  '  앱 표시 ' + Number(b || 0));
        }
      }
      다름 += bad;
      line('  ' + pad_(chk.t, 5) + pad_(chk.s + '.' + col, 22) +
           padL_(n + '칸', 7) + padL_(bad === 0 ? '같음' : bad + '칸 다름', 10) +
           (보기 ? '   ' + 보기 : ''));
    });
  });

  SHEET_CACHE_ON = 캐시원래;

  line('');
  line('■ 결론');
  line('  검사한 칸 ' + 검사한칸 + '개 · 다른 칸 ' + 다름 + '개');
  line(다름 === 0
    ? '  값이 하나도 변하지 않았습니다. 안 D 를 적용해도 됩니다.'
    : '  ★ 다른 칸이 있습니다. 안 D 를 적용하면 안 됩니다. 위 목록을 보고해주세요.');

  var msg = L.join('\n');
  Logger.log(msg);
  console.log(msg);
  try {
    SpreadsheetApp.getUi().alert('캐시 확인 결과', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {}
  return msg;
}

// =============================================================
//  ★ 날짜 확인 (편집기에서 실행) ★
//
//  v41에서 Utilities.formatDate 를 직접 계산으로 바꿨다 (한 번에 1ms 가까이 들어서).
//  그 계산이 옛 방식과 **한 글자도 다르지 않은지** 검사한다.
//  ★ 아무것도 바꾸지 않는다. 읽고 견주기만 한다. ★
// =============================================================
function 날짜_확인() {
  var L = [];
  var line = function (s) { L.push(s); };
  var 다름 = 0, 검사 = 0;

  line('예전 방식(Utilities.formatDate)과 지금 방식(직접 계산)을 견줍니다.');
  line('★ 아무것도 바꾸지 않습니다.');
  line('');

  var 견주기 = function (d, 어디) {
    if (!(d instanceof Date)) return;
    검사++;
    var pairs = [
      ['yyyy-MM-dd',       fmtD_(d),  Utilities.formatDate(d, TZ, 'yyyy-MM-dd')],
      ['yyyy-MM-dd HH:mm', fmtDT_(d), Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm')],
      ['HH:mm',            fmtT_(d),  Utilities.formatDate(d, TZ, 'HH:mm')],
      ['yyyy-MM',          fmtM_(d),  Utilities.formatDate(d, TZ, 'yyyy-MM')]
    ];
    pairs.forEach(function (p) {
      if (p[1] !== p[2]) {
        다름++;
        if (다름 <= 20) line('  ★ ' + 어디 + '  ' + p[0] + '  지금 "' + p[1] + '"  예전 "' + p[2] + '"');
      }
    });
  };

  // ---- 1. 시트에 실제로 들어 있는 날짜 전부 ----
  line('■ 1. 시트에 들어 있는 날짜 전부');
  var 캐시원래 = SHEET_CACHE_ON;
  SHEET_CACHE_ON = false;                  // 시트에서 직접 읽어 원본 Date 로 견준다
  var names = ['업무', '업무일지', '정산내역', '결재문서', '결재선', '결재내역',
               '댓글', '게시글', '알림', '직원', '첨부', '읽음', '휴가', '로그', '연동캐시'];
  names.forEach(function (n) {
    속도_초기화_();
    var sh = null;
    try { sh = ss_().getSheetByName(n); } catch (e) {}
    if (!sh) return;
    var vals = values_(n);
    var cnt = 0;
    for (var i = 1; i < vals.length; i++) {
      for (var j = 0; j < vals[i].length; j++) {
        if (vals[i][j] instanceof Date) { 견주기(vals[i][j], n + ' ' + (i + 1) + '행'); cnt++; }
      }
    }
    line('  ' + pad_(n, 10) + padL_(cnt + '칸', 8));
  });
  SHEET_CACHE_ON = 캐시원래;
  line('');

  // ---- 2. 까다로운 시각들 (경계값) ----
  line('■ 2. 경계값');
  var 경계 = [
    ['자정 직전',   new Date(2026, 0, 1, 23, 59, 59)],
    ['자정',        new Date(2026, 0, 1, 0, 0, 0)],
    ['정오',        new Date(2026, 5, 15, 12, 0, 0)],
    ['오전 12시대', new Date(2026, 5, 15, 0, 30, 0)],
    ['오후 12시대', new Date(2026, 5, 15, 12, 30, 0)],
    ['연말',        new Date(2026, 11, 31, 23, 59, 0)],
    ['연초',        new Date(2027, 0, 1, 0, 0, 0)],
    ['윤년 2월29일', new Date(2028, 1, 29, 9, 5, 0)],
    ['한자리 월일', new Date(2026, 2, 3, 4, 5, 0)],
    ['지금',        now_()]
  ];
  경계.forEach(function (x) {
    견주기(x[1], x[0]);
    line('  ' + pad_(x[0], 14) + fmtDT_(x[1]) + '   (' + fmtD_(x[1]) + ' / ' + fmtT_(x[1]) + ' / ' + fmtM_(x[1]) + ')');
  });
  line('');

  // ---- 3. daysBetween_ ----
  line('■ 3. 날짜 사이 일수 (daysBetween_)');
  var 쌍 = [['2026-08-01', '2026-08-26'], ['2026-12-31', '2027-01-01'],
            ['2028-02-28', '2028-03-01'], ['2026-08-26', '2026-08-26'],
            ['2026-08-26', '2026-08-01']];
  var 일수다름 = 0;
  쌍.forEach(function (p) {
    var 지금 = daysBetween_(p[0], p[1]);
    var 예전 = Math.round((new Date(p[1] + 'T00:00:00+09:00') - new Date(p[0] + 'T00:00:00+09:00')) / 86400000);
    if (지금 !== 예전) { 일수다름++; 다름++; }
    line('  ' + p[0] + ' → ' + p[1] + '  ' + padL_(지금, 5) + '일' +
         (지금 === 예전 ? '' : '   ★ 예전은 ' + 예전));
  });
  line('');

  line('■ 결론');
  line('  날짜 ' + 검사 + '개를 4가지 형식으로 견줌 · 다른 것 ' + 다름 + '개');
  line(다름 === 0
    ? '  한 글자도 다르지 않습니다.'
    : '  ★ 다른 것이 있습니다. 위 목록을 보고해주세요.');

  var msg = L.join('\n');
  Logger.log(msg);
  console.log(msg);
  try { SpreadsheetApp.getUi().alert('날짜 확인 결과', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

/** 자동작업 해제 */
function 자동동기화_해제() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var f = t.getHandlerFunction();
    if (f === 'syncAttendanceJob' || f === 'syncEstimateJob') ScriptApp.deleteTrigger(t);
  });
  return '해제되었습니다.';
}

// =============================================================
//  API - 진행판
// =============================================================

function api_board(token, corp) {
  var u = requireUser_(token);
  var b = board_(userInfo_(u), corp);
  logTiming_('api_board');
  return b;
}

/**
 * 저장 API들이 응답에 같이 실어 보내기 위해 분리.
 *
 * 여기서 읽은 시트를 상세 화면까지 그대로 쓴다.
 * 업무를 눌러 열 때·결재 탭에 들어갈 때 서버에 다시 묻지 않게 하기 위해서다.
 * 새로 읽는 시트는 '정산내역' 하나뿐이고, 그것도 요청당 1회만 읽는다.
 */
function board_(me, corp) {
  var _tRead = new Date().getTime();
  var nameOf = nameMap_();
  var proxy = proxyTargets_(me.phone);   // 직원 시트는 이미 읽혀 있다 (캐시)
  var tasks = readObjects_('업무');
  var logs = readObjects_('업무일지');
  var docRows = readObjects_('결재문서');
  var lineRows = readObjects_('결재선');
  var setRows = readObjects_('정산내역');
  var postRows = tailObjects_('게시글', 200);   // 공지 최신 3건만 쓴다
  var cmtRows = readObjects_('댓글');
  var itemRows = readObjects_('결재내역');
  var detRows = readObjects_('문서상세');
  var fileRows = readObjects_('첨부');
  var m = meta_();                       // 시트를 읽지 않고 캐시에서
  add_('합계:재료읽기', _tRead);          // 이 아래 단계들은 시트를 더 읽지 않는다

  var _tBuild = new Date().getTime();
  // 이름 붙이기는 사용 안 하는 유형까지 (총무처럼 그만 쓰는 유형의 옛 업무도 이름이 보이게)
  var typeName = {};
  (m.typeAll || m.types).forEach(function (t) { typeName[t.code] = t.name; });
  var corpName = {};
  m.corps.forEach(function (c) { corpName[c.code] = c.name; });

  // 업무별로 기록을 한 번만 모아둔다 (업무마다 전체 기록을 다시 훑지 않게)
  var _t = new Date().getTime();
  var byTask = {};
  logs.forEach(function (l) {
    var lid = l['업무ID'];
    if (!byTask[lid]) byTask[lid] = [];
    byTask[lid].push(l);
  });

  // 업무별 최근 기록
  var lastLog = {};
  logs.forEach(function (l) {
    var id = l['업무ID'];
    var d = fmtD_(l['일자']);
    if (!lastLog[id] || d > lastLog[id].date) {
      lastLog[id] = {
        date: d,
        text: String(l['작업내용'] || '').split('\n')[0].replace(/^한\s*일\s*[|｜:]\s*/, ''),
        next: l['다음할일'] || '',
        extra: l['추가견적필요'] === 'Y'
      };
    }
  });

  add_('단계:기록모으기', _t);

  // 결재 중인 추가공사 금액 (아직 계약금액에 반영되지 않은 돈)
  _t = new Date().getTime();
  var pendingAdd = {};
  docRows.forEach(function (d) {
    if (d['양식코드'] !== 'ADD') return;
    if (d['상태'] !== '진행중') return;
    var k = d['업무ID'];
    if (!k) return;
    pendingAdd[k] = (pendingAdd[k] || 0) + Number(d['총금액'] || 0);
  });

  add_('단계:미승인추가공사', _t);

  _t = new Date().getTime();
  var out = [];
  var vis = {};                          // 이 사람이 볼 수 있는 업무만 표시해둔다
  var isDemo = {};                       // 정산은 철거(DEMO)에만 붙는다
  var td = today_();
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (!t['업무ID']) continue;
    if (!canSeeTask_(me, t)) continue;   // 권한만 서버에서, 법인 필터는 화면에서

    var status = t['상태'] || '대기';
    var due = fmtD_(t['마감일']);
    var start = fmtD_(t['시작예정일']);
    var done = fmtD_(t['완료일']);

    // 완료는 최근 14일만
    if (status === '완료' && done && daysBetween_(done, td) > 30) continue;

    var ll = lastLog[t['업무ID']];
    var stale = ll ? daysBetween_(ll.date, td) : (start ? daysBetween_(start, td) : 0);

    var flags = [];
    if (status !== '완료' && due && due < td) flags.push({ t: '마감 지남', lv: 'danger' });
    else if (status !== '완료' && due === td) flags.push({ t: '오늘 마감', lv: 'danger' });
    // 시작예정일은 더 이상 입력받지 않는다 → '시작일 지남' 경고도 만들지 않는다
    if (status === '진행중' && stale >= 7) flags.push({ t: '기록 ' + stale + '일 없음', lv: 'warn' });
    if (ll && ll.extra) flags.push({ t: '추가견적 필요', lv: 'warn' });
    if (pendingAdd[t['업무ID']]) {
      flags.push({ t: '미승인 추가 ' + won_(pendingAdd[t['업무ID']]) + '원', lv: 'warn' });
    }

    out.push({
      id: t['업무ID'],
      type: t['유형코드'], typeName: typeName[t['유형코드']] || t['유형코드'],
      corp: t['법인코드'], corpName: corpName[t['법인코드']] || t['법인코드'],
      title: t['업무명'],
      content: String(t['내용'] == null ? '' : t['내용']),
      owner: normPhone_(t['담당자전화']), ownerName: nameOf[normPhone_(t['담당자전화'])] || '',
      status: status,
      at: fmtDT_(t['등록일시']),          // 언제 올린 업무인지 (상세에 표시)
      start: start, due: due, done: done,
      progress: Number(t['진행률'] || 0),
      site: t['현장코드'] || '', area: t['면적'] || '', scope: t['작업범위'] || '',
      addr: t['주소'] || '', tel: String(t['고객연락처'] || ''), vat: t['VAT구분'] || '',
      co: String(t['협업자전화'] || ''),
      amount: Number(t['계약금액'] || 0),
      lastLog: ll ? (ll.date + ' ' + ll.text) : '',
      next: ll ? ll.next : '',
      flags: flags,
      manpower: manpowerOf_(byTask[t['업무ID']] || [], t['업무ID']),
      waste: wasteOf_(byTask[t['업무ID']] || [], t['업무ID'])
    });
    vis[t['업무ID']] = true;
    if (t['유형코드'] === 'DEMO') isDemo[t['업무ID']] = true;
  }
  add_('단계:업무카드', _t);

  /* ---- 여기서부터는 상세 창을 왕복 없이 여는 데 쓰는 재료 ----
     전부 위에서 이미 읽어둔 데이터로만 만든다. 시트를 더 읽지 않는다.
     권한을 통과한 업무(vis)의 것만 담는다. */

  // 업무별 최근 기록 5건 + 전체 건수 (권한을 통과한 업무만)
  _t = new Date().getTime();
  var logsByTask = {}, logCount = {};
  Object.keys(byTask).forEach(function (lid) {
    if (!vis[lid]) return;
    var list = byTask[lid];
    logCount[lid] = list.length;
    logsByTask[lid] = list.slice().sort(function (a, b) {
      var da = fmtD_(a['일자']), db = fmtD_(b['일자']);
      if (da !== db) return da < db ? 1 : -1;     // 최근 날짜가 위로
      return b._row - a._row;                     // 같은 날이면 나중에 쓴 것이 위로
    }).slice(0, 5).map(function (l) { return logOut_(l, nameOf); });
  });

  add_('단계:logsByTask', _t);

  // 업무별 관련 결재
  _t = new Date().getTime();
  var docsByTask = {};
  docRows.forEach(function (d) {
    var did = d['업무ID'];
    if (!did || !vis[did]) return;
    if (!docsByTask[did]) docsByTask[did] = [];
    docsByTask[did].push({
      no: d['문서번호'], title: d['제목'],
      amount: Number(d['총금액'] || 0), status: d['상태']
    });
  });

  /* 업무별 정산 (정산내역 시트는 이 요청에서 딱 한 번만 읽었다).
     철거(DEMO) 업무에만 담는다. 다른 유형에는 아예 내려보내지 않으므로
     화면에서 가리는 것이 아니라 데이터가 없어서 안 보이는 것이다. */
  add_('단계:docsByTask', _t);

  _t = new Date().getTime();
  var setByTask = {};
  setRows.forEach(function (r) {
    var sid = r['업무ID'];
    if (!isDemo[sid]) return;
    if (!setByTask[sid]) setByTask[sid] = [];
    setByTask[sid].push({
      id: r['정산ID'], kind: r['구분'], amount: Number(r['금액'] || 0),
      memo: r['사유'] || '', date: fmtD_(r['일자']),
      docNo: r['결재문서번호'] || '', tax: r['세금계산서'] || ''
    });
  });
  var settle = {};
  Object.keys(isDemo).forEach(function (sid) {          // 줄이 없는 철거 업무도 빈 정산을 준다
    var srows = (setByTask[sid] || []).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var sum = settleSummary_(sid, srows);      // 계산 규칙은 한 곳에서만
    sum.claim = sum.total;                     // 청구액 (공급가 + 부가세)
    sum.rows = srows;                          // 상세 창의 '정산 내역' 목록용
    settle[sid] = sum;
  });
  add_('단계:정산', _t);

  // 상단에 붙일 공지 최신 3건 (만료 개념 없음 — 필요 없으면 지운다)
  _t = new Date().getTime();
  var notices = postRows.filter(function (p) {
    return p['글번호'] && String(p['종류'] || '') === '공지';
  }).sort(function (a, b) {
    var da = fmtDT_(a['작성일시']), db = fmtDT_(b['작성일시']);
    if (da !== db) return da < db ? 1 : -1;     // 최신이 위로
    return b._row - a._row;
  }).slice(0, 3).map(function (p) {
    return {
      no: p['글번호'], title: p['제목'],
      // 본문까지 담는다 — 공지 줄을 눌러도 서버에 가지 않게 (3건뿐이라 가볍다)
      body: String(p['내용'] == null ? '' : p['내용']),
      who: nameOf[normPhone_(p['작성자전화'])] || '',
      phone: normPhone_(p['작성자전화']),
      at: fmtD_(p['작성일시']),
      edited: fmtDT_(p['수정일시'])
    };
  });

  add_('단계:공지', _t);

  // 업무별 댓글 최근 3건 + 총 개수 (권한을 통과한 업무만)
  _t = new Date().getTime();
  var cmtByTask = {};
  cmtRows.forEach(function (c) {
    if (String(c['대상구분'] || '') !== '업무') return;
    var tid = c['대상ID'];
    if (!vis[tid]) return;
    if (!cmtByTask[tid]) cmtByTask[tid] = [];
    cmtByTask[tid].push(c);
  });
  var commentsByTask = {}, commentCount = {};
  Object.keys(cmtByTask).forEach(function (tid) {
    var list = cmtByTask[tid];
    commentCount[tid] = list.length;
    commentsByTask[tid] = list.slice().sort(function (a, b) {
      var da = fmtDT_(a['작성일시']), db = fmtDT_(b['작성일시']);
      if (da !== db) return da < db ? 1 : -1;
      return b._row - a._row;
    }).slice(0, 3).reverse()                    // 최근 3건을 오래된 순으로 보여준다
      .map(function (c) { return commentOut_(c, nameOf); });
  });

  /* 결재 문서 상세를 통째로 실어 보낸다 (v35).
     문서를 눌렀을 때 '내역 불러오는 중' 을 보지 않게 하려는 것.
     시트는 위에서 이미 다 읽었으므로 여기서 더 읽지 않는다.
     진행중 문서는 전부, 끝난 문서는 최근 40건까지만 담아 응답이 무한정 커지지 않게 한다. */
  /* 안 읽은 댓글 배지 — 판정은 서버에서 (v44).
     예전에는 화면이 S.seen 으로 스스로 판단해서, 새로고침하면 이미 본 댓글에
     점이 되살아났다. 이제 '읽음' 시트에 사람별·업무별로 마지막으로 본 시각을 남긴다.
     ★ '읽음' 은 v43부터 캐시 대상이라 같은 getAll 에 실려 온다 — 구글 왕복이 늘지 않는다. */
  var seenAt = {};
  readObjects_('읽음').forEach(function (r) {
    if (String(r['대상구분'] || '') !== '댓글') return;
    if (normPhone_(r['전화번호']) !== me.phone) return;
    var k = r['대상ID'];
    var at = fmtDT_(r['읽은일시']);
    if (!seenAt[k] || at > seenAt[k]) seenAt[k] = at;
  });

  var cmtDot = {};
  Object.keys(cmtByTask).forEach(function (tid) {
    var last = seenAt[tid] || '';
    for (var ci = 0; ci < cmtByTask[tid].length; ci++) {
      var c = cmtByTask[tid][ci];
      if (normPhone_(c['작성자전화']) === me.phone) continue;   // 내가 쓴 댓글은 세지 않는다
      if (fmtDT_(c['작성일시']) > last) { cmtDot[tid] = true; break; }
    }
  });
  add_('단계:댓글', _t);

  _t = new Date().getTime();
  var docs = docList_(me, docRows, lineRows, nameOf, proxy);
  add_('단계:결재목록', _t);

  _t = new Date().getTime();
  var want = {};
  var doneSeen = 0;
  ['toAct', 'drafts', 'others'].forEach(function (k) {
    (docs[k] || []).forEach(function (x) {
      if (x.status === '진행중') { want[x.no] = true; return; }
      if (doneSeen < 15) { want[x.no] = true; doneSeen++; }
    });
  });

  var lineBy = {}, itemBy = {}, detBy = {}, fileBy = {};
  lineRows.forEach(function (l) {
    var k = l['문서번호']; if (!want[k]) return;
    (lineBy[k] = lineBy[k] || []).push(l);
  });
  itemRows.forEach(function (i) {
    var k = i['문서번호']; if (!want[k]) return;
    (itemBy[k] = itemBy[k] || []).push(i);
  });
  detRows.forEach(function (d) {
    var k = d['문서번호']; if (!want[k]) return;
    (detBy[k] = detBy[k] || []).push(d);
  });
  fileRows.forEach(function (f) {
    var k = f['대상ID']; if (!want[k]) return;
    (fileBy[k] = fileBy[k] || []).push(f);
  });

  var docPack = {};
  var rankOf = rankMap_();          // 문서마다 다시 만들지 않는다
  docRows.forEach(function (d) {
    var k = d['문서번호'];
    if (!want[k]) return;
    docPack[k] = docDetailFrom_(d, lineBy[k] || [], itemBy[k] || [],
                                fileBy[k] || [], detBy[k] || [],
                                me, nameOf, rankOf, proxy);
  });
  add_('단계:docPack', _t);
  _TN['docPack(문서수)'] = { rows: Object.keys(docPack).length, cols: 0 };

  _t = new Date().getTime();
  var attendance = attendanceToday_(nameOf);
  add_('단계:출퇴근', _t);

  _t = new Date().getTime();
  var leaves = leavesFor_(nameOf, me);
  var events = eventsFor_(nameOf, me);
  var ekinds = eventKinds_();
  add_('단계:휴가·일정', _t);

  _t = new Date().getTime();
  var recent = recentLogs_(logs, nameOf, tasks);
  var stat = monthStat_(tasks);
  var statByCorp = monthStatByCorp_(tasks);
  add_('단계:최근기록·통계', _t);

  _t = new Date().getTime();
  var noti = myNotifications_(me);
  add_('단계:알림', _t);

  _t = new Date().getTime();
  var approvals = pendingDocs_(me, docRows, lineRows, nameOf, proxy);
  add_('단계:결재대기', _t);

  var lastUp = lastUpdate_();
  add_('합계:응답만들기', _tBuild);

  var res = {
    ok: true,
    me: me,
    tasks: out,
    docPack: docPack,
    logsByTask: logsByTask,
    logCount: logCount,
    docsByTask: docsByTask,
    settle: settle,
    notices: notices,
    commentsByTask: commentsByTask,
    commentCount: commentCount,
    cmtDot: cmtDot,             // 업무별 안 읽은 댓글 배지 (판정은 서버에서, v44)
    docs: docs,
    approvals: approvals,
    attendance: attendance,
    leaves: leaves,             // 휴가 달력 (v46) — 달력을 열 때 서버에 다시 묻지 않는다
    events: events,             // 회사 일정 (v47) — 같은 이유로 여기 실어 보낸다
    eventKinds: ekinds.use,     // 새로 넣을 때 고를 수 있는 구분
    eventKindAll: ekinds.all,   // 이름을 붙이는 데 쓰는 전체 (사용 안 하는 것 포함)
    staff: staffList_(),        // 담당자 드롭다운 (v46c) — 업무가 없어도 목록에 뜨게
    recent: recent,
    stat: stat,
    statByCorp: statByCorp,
    noti: noti,
    lastUpdate: lastUp,
    vers: areaVers_(),          // 분야별 번호표 (v43) — 화면이 캐시를 언제 버릴지 판단한다
    at: fmtT_(now_()),
    ms: took_()
  };
  res.t = timing_();
  return res;
}

/**
 * 회사 일정 (v47) — 달력이 board 와 같은 한 번에 실려 온다.
 *
 * ★ '일정' 은 CACHE_SHEETS 에 들어 있어 이미 한 번에 가져온 것(getAll) 안에 있다.
 *   시트를 새로 열지 않으므로 **구글에 묻는 횟수가 늘지 않는다** (휴가와 같은 방식).
 * ★ 최근 6개월 + 앞으로 6개월만 보낸다. 응답이 해마다 커지지 않게.
 * ★ 고칠 수 있는지(canEdit)를 서버가 판정해서 실어 보낸다.
 *   화면은 이 값만 보고 버튼을 그리고, 저장·삭제 API 가 같은 규칙을 다시 확인한다.
 */
function eventsFor_(nameOf, me) {
  var td = today_();
  var from = shiftMonth_(td, -6);
  var to = shiftMonth_(td, 6);

  var out = [];
  readObjects_('일정').forEach(function (r) {
    var s1 = fmtD_(r['시작일']);
    if (!s1) return;
    var s2 = fmtD_(r['종료일']) || s1;
    if (s2 < s1) s2 = s1;

    /* 기간이 창 밖으로 완전히 벗어난 것만 뺀다 (걸쳐 있으면 넣는다) */
    if (s2 < from || s1 > to) return;

    var who = normPhone_(r['대상자전화']);
    var by = normPhone_(r['등록자전화']);
    out.push({
      id: String(r['일정ID'] || ''),
      from: s1, to: s2,
      time: fmtT_(r['시각']),
      kind: String(r['구분'] || ''),
      phone: who,
      name: String(nameOf[who] || ''),
      title: cellText_(r['제목']),
      body: cellText_(r['내용']),
      by: by,
      byName: String(nameOf[by] || ''),
      canEdit: canEditEvent_(me, r)
    });
  });

  out.sort(function (a, b) {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return a.title < b.title ? -1 : 1;
  });
  return out;
}

/**
 * 일정 구분 — 고를 수 있는 것(use)과 이름을 붙이는 데 쓰는 전체(all).
 * 업무유형(types / typeAll)과 같은 방식이다.
 * ★ 사용여부가 'N' 이어도 all 에는 남긴다. 안 그러면 이미 그 구분으로 등록된
 *   일정이 'VISIT' 같은 코드로 보인다.
 */
function eventKinds_() {
  var rows = readObjects_('일정구분').filter(function (r) { return r['구분코드']; });
  rows = rows.slice().sort(function (a, b) {
    return Number(a['표시순서'] || 99) - Number(b['표시순서'] || 99);
  });
  return {
    use: rows.filter(function (r) { return String(r['사용여부'] || 'Y') !== 'N'; })
             .map(function (r) {
               return { code: String(r['구분코드']), name: String(r['구분명'] || r['구분코드']) };
             }),
    all: rows.map(function (r) {
      return { code: String(r['구분코드']), name: String(r['구분명'] || r['구분코드']),
               off: String(r['사용여부'] || 'Y') === 'N' };
    })
  };
}

/**
 * 일정을 고치고 지울 수 있는 사람 — 넣은 사람 · 대상자 · 관리자(9).
 *
 * ★ 판정은 반드시 서버에서 한다. 화면에서 버튼을 숨기는 것만으로는 막히지 않는다
 *   (요청을 직접 만들어 보내면 그대로 통과한다).
 */
function canEditEvent_(me, row) {
  if (!me || !row) return false;
  if (Number(me.grade || 0) >= 9) return true;
  return normPhone_(row['등록자전화']) === me.phone ||
         normPhone_(row['대상자전화']) === me.phone;
}

// =============================================================
//  API - 회사 일정 (달력)
// =============================================================

/**
 * 일정 저장 (새로 넣기 / 고치기) — 서버 왕복 1회.
 *
 * ★ 응답에 board 를 싣지 않는다 (v33 규칙).
 *   방금 넣은 한 건만 돌려주고 화면이 그것으로 달력을 고친다.
 *   정확한 값은 뒤에서 도는 softRefresh 가 맞춘다.
 * ★ 남의 일정도 넣을 수 있다 (대상자를 명부에서 고른다).
 *   고치고 지우는 것만 넣은 사람 · 대상자 · 관리자로 제한한다.
 */
function api_saveEvent(token, p, corp) {
  var me = userInfo_(requireUser_(token));
  ensureCalendarSheets_();
  p = p || {};

  var from = String(p.from || '').trim().substring(0, 10);
  var to = String(p.to || '').trim().substring(0, 10);
  var time = String(p.time || '').trim().substring(0, 5);
  var kind = String(p.kind || '').trim();
  var who = normPhone_(p.phone) || me.phone;
  var title = String(p.title || '').trim();
  var body = String(p.body || '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { ok: false, msg: '날짜를 정해주세요.' };
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return { ok: false, msg: '종료일이 올바르지 않습니다.' };
  if (to && to < from) return { ok: false, msg: '종료일이 시작일보다 앞설 수 없습니다.' };
  if (!/^\d{2}:\d{2}$/.test(time)) return { ok: false, msg: '시각을 입력해주세요.' };
  if (!title) return { ok: false, msg: '제목을 입력해주세요.' };

  var known = {};
  eventKinds_().all.forEach(function (k) { known[k.code] = k; });
  if (!kind || !known[kind]) return { ok: false, msg: '일정 구분을 골라주세요.' };

  // 대상자는 재직 중인 직원이어야 한다
  var okWho = false, whoName = '';
  staffList_().forEach(function (s) {
    if (s.phone === who) { okWho = true; whoName = s.name; }
  });
  if (!okWho) return { ok: false, msg: '대상자를 다시 골라주세요.' };

  var nowS = fmtDT_(now_());
  var id = String(p.id || '').trim();
  var isEdit = !!id;

  if (isEdit) {
    var target = null;
    readObjects_('일정').forEach(function (r) { if (String(r['일정ID']) === id) target = r; });
    if (!target) return { ok: false, msg: '일정을 찾을 수 없습니다.' };
    if (!canEditEvent_(me, target)) {
      return { ok: false, msg: '넣은 사람과 대상자만 고칠 수 있습니다.' };
    }
    updateObject_('일정', target._row, {
      '시작일': from, '종료일': to, '시각': time, '구분': kind,
      '대상자전화': who, '제목': title, '내용': body, '수정일시': nowS
    });
  } else {
    id = nextId_('일정', '일정ID', 'E');
    appendObject_('일정', {
      '일정ID': id, '시작일': from, '종료일': to, '시각': time, '구분': kind,
      '대상자전화': who, '제목': title, '내용': body,
      '등록자전화': me.phone, '등록일시': nowS, '수정일시': ''
    });
  }

  var res = {
    ok: true,
    event: {
      id: id, from: from, to: (to || from), time: time, kind: kind,
      phone: who, name: whoName,
      title: title, body: body,
      by: me.phone, byName: me.name,
      canEdit: true                       // 방금 내가 넣었거나 고친 것이다
    },
    ms: took_()
  };
  log_(me.phone, isEdit ? '일정수정' : '일정등록', id, token);   // 로그는 응답을 만든 뒤에
  return res;
}

/** 일정 삭제 — 넣은 사람 · 대상자 · 관리자(9) */
function api_deleteEvent(token, id, corp) {
  var me = userInfo_(requireUser_(token));
  id = String(id || '').trim();

  var target = null;
  readObjects_('일정').forEach(function (r) { if (String(r['일정ID']) === id) target = r; });
  if (!target) return { ok: false, msg: '일정을 찾을 수 없습니다.' };
  if (!canEditEvent_(me, target)) {
    return { ok: false, msg: '넣은 사람과 대상자만 지울 수 있습니다.' };
  }

  deleteRows_('일정', [target._row]);

  var res = { ok: true, id: id, ms: took_() };
  log_(me.phone, '일정삭제', id, token);
  return res;
}

/**
 * 휴가 지우기 — 관리자(9)만 (v52).
 *
 * ★ 휴가는 원래 결재로만 생기고 사라집니다 (휴가 신청서가 최종 승인될 때
 *   addLeave_ 가 한 줄 쌓습니다). 잘못 올라간 줄을 관리자가 달력에서 바로
 *   치울 수 있게 이 통로 하나만 열어 둡니다.
 *
 * ★ 이것은 **달력에서 그 줄을 지우는 것뿐**입니다.
 *   이미 승인된 결재 문서는 그대로 남습니다 (결재 기록을 지우면 안 되니까).
 *   그래서 화면에서 물어볼 때도 그 점을 분명히 말합니다.
 *
 * ★ 판정은 여기서 합니다. 화면에서 버튼을 숨기는 것으로 막지 않습니다.
 */
function api_deleteLeave(token, id, corp) {
  var me = userInfo_(requireUser_(token));
  if (Number(me.grade || 0) < 9) {
    return { ok: false, msg: '관리자만 지울 수 있습니다.' };
  }
  id = String(id || '').trim();
  if (!id) return { ok: false, msg: '휴가를 찾을 수 없습니다.' };

  var target = null;
  readObjects_('휴가').forEach(function (r) { if (String(r['휴가ID']) === id) target = r; });
  if (!target) return { ok: false, msg: '휴가를 찾을 수 없습니다.' };

  deleteRows_('휴가', [target._row]);

  var res = { ok: true, id: id, ms: took_() };
  log_(me.phone, '휴가삭제', id + ' / ' + String(target['문서번호'] || ''), token);
  return res;
}

/**
 * 휴가 달력 재료 (v46).
 *
 * '휴가' 시트는 휴가 신청서가 최종 승인될 때 addLeave_ 가 한 줄씩 쌓는다.
 * 사람이 따로 입력하는 곳이 없다.
 *
 * ★ 시트를 새로 열지 않는다. '휴가' 는 CACHE_SHEETS 에 들어 있어
 *   board_ 가 이미 한 번에 가져온 것 안에 들어 있다 (구글 왕복 0회).
 * ★ 최근 6개월 + 앞으로 6개월만 보낸다. 응답이 해마다 커지지 않게.
 */
function leavesFor_(nameOf, me) {
  var td = today_();
  var from = shiftMonth_(td, -6);
  var to = shiftMonth_(td, 6);

  var out = [];
  readObjects_('휴가').forEach(function (r) {
    var s1 = fmtD_(r['시작일']);
    if (!s1) return;
    var s2 = fmtD_(r['종료일']) || s1;
    if (s2 < s1) s2 = s1;

    /* 기간이 창 밖으로 완전히 벗어난 것만 뺀다 (걸쳐 있으면 넣는다) */
    if (s2 < from || s1 > to) return;

    var ph = normPhone_(r['전화번호']);
    out.push({
      id: r['휴가ID'],
      name: String(r['이름'] || nameOf[ph] || ''),
      phone: ph,
      kind: String(r['휴가종류'] || ''),
      from: s1, to: s2,
      days: Number(r['일수'] || 0),
      docNo: String(r['문서번호'] || ''),
      /* 지울 수 있는지 — 관리자(9)만 (v52). 판정은 여기서 하고
         화면은 이 값만 보고 버튼을 그린다. api_deleteLeave 가 다시 확인한다. */
      canDel: Number((me && me.grade) || 0) >= 9
    });
  });

  out.sort(function (a, b) {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  });
  return out;
}

/** 'yyyy-MM-dd' 에서 달만 옮긴다 (Date 객체를 만들지 않는다) */
function shiftMonth_(dateStr, n) {
  var y = Number(String(dateStr).substring(0, 4));
  var m = Number(String(dateStr).substring(5, 7)) + n;
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return z4_(y) + '-' + z2_(m) + '-01';
}

/** 댓글 한 줄을 화면이 쓰는 모양으로 */
function commentOut_(c, nameOf) {
  var ph = normPhone_(c['작성자전화']);
  return {
    id: c['댓글ID'], kind: c['대상구분'], target: c['대상ID'],
    who: nameOf[ph] || '', phone: ph,
    text: String(c['내용'] == null ? '' : c['내용']),
    at: fmtDT_(c['작성일시'])
  };
}

/** 업무일지 한 줄을 화면이 쓰는 모양으로. board_ 와 api_taskDetail 이 같이 쓴다 */
function logOut_(l, nameOf) {
  return {
    id: l['일지ID'], date: fmtD_(l['일자']),
    who: nameOf[normPhone_(l['작성자전화'])] || '',
    text: l['작업내용'] || '',
    g: Number(l['기공수'] || 0), j: Number(l['조공수'] || 0),
    eq: l['장비'] || '', eqd: l['장비일수'] || '',
    wt: l['폐기물종류'] || '', wton: Number(l['폐기물톤수'] || 0),
    progress: Number(l['진행률'] || 0),
    extra: l['추가견적필요'] === 'Y',
    next: l['다음할일'] || '', nextDate: fmtD_(l['다음일정일']),
    photo: l['사진링크'] || ''
  };
}

/** 내 안 읽은 알림 (board 응답에 같이 실어 보낸다) */
function myNotifications_(me) {
  // 최근 20건만 보여주므로 시트 전체를 읽지 않는다 (알림은 계속 쌓이기만 한다)
  var rows = tailObjects_('알림', 400).filter(function (n) {
    return normPhone_(n['대상전화']) === me.phone && !n['읽음일시'];
  });
  return rows.slice(-20).reverse().map(function (n) {
    return { id: n['알림ID'], kind: n['유형'], text: n['내용'], at: fmtDT_(n['생성일시']).substring(5) };
  });
}

function won_(n) { return Number(n || 0).toLocaleString('en-US'); }

/**
 * 'yyyy-MM-dd' 두 개 사이의 날짜 수.
 * 예전에는 글자에서 Date 객체를 두 개씩 만들었다. 업무 카드마다 부르는 자리라
 * 숫자로만 계산한다 (v41). Date.UTC 는 객체를 만들지 않는다.
 */
function dayNo_(s) {
  s = String(s);
  if (s.length < 10) return NaN;
  var y = Number(s.substring(0, 4)), m = Number(s.substring(5, 7)), d = Number(s.substring(8, 10));
  if (!y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}
function daysBetween_(a, b) {
  if (!a || !b) return 0;
  var na = dayNo_(a), nb = dayNo_(b);
  if (isNaN(na) || isNaN(nb)) return 0;
  return nb - na;
}

/**
 * 대리 결재 (v32).
 * '직원' 시트의 '대리인전화' 에 내 번호가 적힌 사람들을 돌려준다.
 * 그 사람 몫의 결재를 내가 대신 승인·반려할 수 있다. 판정은 언제나 서버에서 한다.
 */
function proxyTargets_(mePhone) {
  var out = {};
  if (!mePhone) return out;
  readObjects_('직원').forEach(function (r) {
    if (r['재직상태'] === '퇴사') return;
    var owner = normPhone_(r['전화번호']);
    if (!owner || owner === mePhone) return;
    String(r['대리인전화'] || '').split(',').forEach(function (d) {
      if (normPhone_(d) === mePhone) out[owner] = true;
    });
  });
  return out;
}

/** 전화번호 -> 직급 */
function rankMap_() {
  var o = {};
  readObjects_('직원').forEach(function (r) {
    o[normPhone_(r['전화번호'])] = String(r['직급'] || '');
  });
  return o;
}

function nameMap_() {
  var o = {};
  readObjects_('직원').forEach(function (r) { o[normPhone_(r['전화번호'])] = r['이름']; });
  return o;
}

/**
 * 담당자로 고를 수 있는 사람 (v46c).
 *
 * 예전에는 화면이 '이미 업무를 맡고 있는 사람 + 나' 만 모아 드롭다운을 만들었습니다.
 * 그래서 명부에 갓 올라온 사람은 업무를 하나 맡기 전까지 고를 수가 없었습니다.
 *
 * ★ board_ 에서만 부릅니다. 로그인한 사람에게만 나갑니다.
 *   기준정보(meta)에는 절대 넣지 마세요 — meta 는 로그인 전에도 나가는 값입니다.
 *   (2026-08-27 계정 사고의 원인이 인증 없이 명부를 내주는 통로였습니다)
 * ★ 이름·전화번호·부서·직급만 보냅니다. PIN·기기토큰·대리인은 담지 않습니다.
 * ★ 시트를 새로 열지 않습니다. board_ 가 이미 '직원' 을 읽었습니다 (구글 왕복 0회).
 */
function staffList_() {
  return readObjects_('직원')
    .filter(function (r) {
      var st = String(r['재직상태'] || '재직');
      return normPhone_(r['전화번호']) && st !== '퇴사' && st !== '승인대기';
    })
    .map(function (r) {
      return {
        phone: normPhone_(r['전화번호']),
        name: String(r['이름'] || ''),
        dept: String(r['부서'] || ''),
        rank: String(r['직급'] || '')
      };
    });
}

/**
 * 업무 열람 범위 (v30) — 재직 중인 직원은 모든 업무를 본다.
 * 업무·업무일지·댓글·금액이 전부 열려 있습니다.
 * 고치고 지우는 권한은 열지 않았습니다 (담당자 본인 또는 관리자, 각 저장 API에서 판정).
 * 결재 문서는 여기 해당하지 않습니다 (본인이 결재선에 든 것만 — docList_ 참고).
 */
function canSeeTask_(me, t) {
  return !!me;   // requireUser_ 를 통과했으면 재직 중인 직원이다
}

function manpowerOf_(logs, taskId) {
  var g = 0, j = 0, latest = '';
  logs.forEach(function (l) {
    if (l['업무ID'] !== taskId) return;
    var d = fmtD_(l['일자']);
    if (d > latest) { latest = d; g = Number(l['기공수'] || 0); j = Number(l['조공수'] || 0); }
  });
  return { g: g, j: j, date: latest };
}

function wasteOf_(logs, taskId) {
  var sum = 0;
  logs.forEach(function (l) { if (l['업무ID'] === taskId) sum += Number(l['폐기물톤수'] || 0); });
  return Math.round(sum * 10) / 10;
}

function monthStat_(tasks) {
  var ym = fmtM_(now_());
  var cnt = 0, amt = 0;
  tasks.forEach(function (t) {
    var d = fmtD_(t['완료일']);
    if (d && d.indexOf(ym) === 0) { cnt++; amt += Number(t['계약금액'] || 0); }
  });
  return { month: ym, count: cnt, amount: amt };
}

/** 법인별 이번 달 실적 — 화면에서 필터를 바꿔도 서버에 다시 묻지 않게 */
function monthStatByCorp_(tasks) {
  var ym = fmtM_(now_());
  var out = { ALL: { month: ym, count: 0, amount: 0 } };
  tasks.forEach(function (t) {
    var d = fmtD_(t['완료일']);
    if (!d || d.indexOf(ym) !== 0) return;
    var c = t['법인코드'] || '';
    if (!out[c]) out[c] = { month: ym, count: 0, amount: 0 };
    var amt = Number(t['계약금액'] || 0);
    out[c].count++; out[c].amount += amt;
    out.ALL.count++; out.ALL.amount += amt;
  });
  return out;
}

/**
 * 최근 기록.
 * ★ 업무명이 빈칸으로 나오지 않게 한다 (v44).
 *   업무 시트에 그 업무ID가 아예 없으면 '(삭제된 업무)',
 *   업무는 있는데 이름이 비어 있으면 '(이름 없는 업무)' 로 구분해서 보낸다.
 *   두 경우는 원인이 다르므로 화면에서 구분되어야 어디를 고칠지 알 수 있다.
 */
function recentLogs_(logs, nameOf, tasks) {
  var titleOf = {}, known = {};
  tasks.forEach(function (t) {
    var id = t['업무ID'];
    if (!id) return;
    known[id] = true;
    titleOf[id] = String(t['업무명'] == null ? '' : t['업무명']).trim();
  });

  var arr = logs.slice(-40).reverse().slice(0, 8);
  return arr.map(function (l) {
    var tid = l['업무ID'];
    var title = known[tid] ? (titleOf[tid] || '(이름 없는 업무)') : '(삭제된 업무)';

    var body = String(l['작업내용'] || '').split('\n')[0]
      .replace(/^한\s*일\s*[|｜:]\s*/, '').trim();

    /* 글 맨 앞의 [완료] 같은 표시는 떼어내서 뱃지로 보낸다.
       제목과 본문이 한 덩어리로 보이던 것을 나누기 위해서다. */
    var tag = '';
    var m = body.match(/^\[([^\]]{1,10})\]\s*/);
    if (m) { tag = m[1]; body = body.substring(m[0].length); }
    else {
      var mt = title.match(/^\[([^\]]{1,10})\]\s*/);
      if (mt) { tag = mt[1]; title = title.substring(mt[0].length).trim() || title; }
    }

    return {
      id: l['일지ID'],
      taskId: tid || '',
      gone: !known[tid],
      who: nameOf[normPhone_(l['작성자전화'])] || '',
      task: title,
      tag: tag,
      text: body.substring(0, 120),
      at: fmtDT_(l['작성일시']).substring(5)
    };
  });
}

// =============================================================
//  출퇴근앱 연동
// =============================================================

function attendanceToday_(nameOf) {
  var staff = readObjects_('직원').filter(function (r) { return r['재직상태'] !== '퇴사'; });
  var td = today_();

  /* 남의 스프레드시트를 열지 않는다. 미리 복사해둔 것만 본다.
     ★ 캐시를 먼저 보고, 캐시가 비었으면 연동캐시 **시트**에서 읽는다 (v39).
       캐시는 구글이 언제든 비우므로 시트가 최종 보관소다. 시트 쓰기를 없애지 않았다. */
  var map = {};
  var linked = false;

  var cached = attGet_();
  if (cached) {
    linked = true;
    cached.forEach(function (r) {
      if (String(r.v3 || '') !== td) return;
      map[normPhone_(r.k)] = { in: String(r.v1 || ''), out: String(r.v2 || '') };
    });
  } else {
    readObjects_('연동캐시').forEach(function (r) {
      if (r['구분'] !== '출퇴근') return;
      linked = true;
      if (fmtD_(r['값3']) !== td) return;
      map[normPhone_(r['키'])] = { in: fmtT_(r['값1']) || String(r['값1'] || ''), out: fmtT_(r['값2']) || '' };
    });
  }

  if (!linked && !String(settings_()['출퇴근시트ID'] || '').trim()) {
    return {
      linked: false,
      rows: staff.map(function (s) { return { name: s['이름'], time: '', state: '-' }; })
    };
  }

  return {
    linked: true,
    rows: staff.map(function (s) {
      var a = map[normPhone_(s['전화번호'])];
      if (!a || !a.in) return { name: s['이름'], time: '', state: '미출근', sort: '99:99' };
      return {
        name: s['이름'],
        time: a.out ? (a.in + '~' + a.out) : a.in,
        state: a.out ? '퇴근' : '출근',
        sort: a.in
      };
    }).sort(function (x, y) {              // 일찍 온 사람이 위로, 미출근은 아래로
      if (x.sort === y.sort) return x.name < y.name ? -1 : 1;
      return x.sort < y.sort ? -1 : 1;
    })
  };
}

// =============================================================
//  API - 업무
// =============================================================

function api_saveTask(token, p, corp) {
  var u = requireUser_(token);
  var me = userInfo_(u);
  var nowS = fmtDT_(now_());

  if (p.id) {
    var rows = readObjects_('업무');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]['업무ID'] === p.id) {
        if (me.grade < 2 && normPhone_(rows[i]['담당자전화']) !== me.phone) {
          return { ok: false, msg: '본인 담당 업무만 수정할 수 있습니다.' };
        }
        updateObject_('업무', rows[i]._row, taskFields_(p, nowS, null));
        if (p.amount && p.type === 'DEMO') seedBaseSettle_(p.id, Number(p.amount), me.phone);
        return { ok: true, id: p.id, ms: took_() };
      }
    }
    return { ok: false, msg: '업무를 찾을 수 없습니다.' };
  }

  var id = nextId_('업무', '업무ID', 'W');
  var obj = taskFields_(p, nowS, me.phone);
  obj['업무ID'] = id;
  obj['등록일시'] = nowS;
  appendObject_('업무', obj);
  if (p.amount && p.type === 'DEMO') seedBaseSettle_(id, Number(p.amount), me.phone);
  return { ok: true, id: id, ms: took_() };
}

/** 업무 삭제 — 딸린 일지·상세도 함께 지움 */
function api_deleteTask(token, id, corp) {
  var u = requireUser_(token);
  var me = userInfo_(u);

  var target = null;
  readObjects_('업무').forEach(function (t) { if (t['업무ID'] === id) target = t; });
  if (!target) return { ok: false, msg: '업무를 찾을 수 없습니다.' };
  if (me.grade < 9 && normPhone_(target['담당자전화']) !== me.phone) {
    return { ok: false, msg: '본인 담당 업무만 삭제할 수 있습니다.' };
  }

  var docs = readObjects_('결재문서').filter(function (d) { return d['업무ID'] === id; });
  if (docs.length) {
    return { ok: false, msg: '이 업무에 연결된 결재문서가 ' + docs.length + '건 있어 삭제할 수 없습니다.' };
  }

  // 시트별로 모아서 구간 삭제 (한 줄씩 지우면 줄 수만큼 느려진다)
  deleteRows_('업무일지', readObjects_('업무일지')
    .filter(function (l) { return l['업무ID'] === id; })
    .map(function (l) { return l._row; }));

  deleteRows_('업무상세', readObjects_('업무상세')
    .filter(function (d) { return d['업무ID'] === id; })
    .map(function (d) { return d._row; }));

  deleteRows_('업무', [target._row]);

  return { ok: true, id: id, ms: took_() };
}

/**
 * 업무 한 줄을 만든다.
 *
 * ★ 화면에서 넘어오지 않은 값은 절대 손대지 않는다. ★
 * v30b 부터 등록 창이 단순해져서 주소·면적·작업범위·연락처·시작예정일을 받지 않습니다.
 * 그 값들은 예전 데이터와 견적앱이 채워 넣은 것이 그대로 살아 있어야 하므로
 * 여기서 빈 값으로 덮어쓰면 안 됩니다.
 */
function taskFields_(p, nowS, creator) {
  var o = { '수정일시': nowS };

  if (p.type !== undefined) o['유형코드'] = p.type;
  if (p.corp !== undefined) o['법인코드'] = p.corp;
  if (p.title !== undefined) o['업무명'] = p.title;
  if (p.owner !== undefined) o['담당자전화'] = normPhone_(p.owner);
  if (p.content !== undefined) o['내용'] = String(p.content == null ? '' : p.content);
  if (p.start !== undefined) o['시작예정일'] = p.start || '';
  if (p.due !== undefined) o['마감일'] = p.due || '';
  if (p.site !== undefined) o['현장코드'] = p.site || '';
  if (p.addr !== undefined) o['주소'] = p.addr || '';
  if (p.tel !== undefined) o['고객연락처'] = normPhone_(p.tel || '');
  if (p.area !== undefined) o['면적'] = p.area || '';
  if (p.scope !== undefined) o['작업범위'] = p.scope || '';
  if (p.amount !== undefined) o['계약금액'] = p.amount ? Number(p.amount) : '';
  if (p.vat !== undefined) o['VAT구분'] = p.vat || '';
  if (p.co !== undefined) o['협업자전화'] = p.co;

  // 진행률은 작업기록이 관리한다. 수정 창에서 넘어오지 않으면 손대지 않는다.
  if (p.progress !== undefined && p.progress !== null && p.progress !== '') {
    o['진행률'] = Number(p.progress);
  }

  // 상태도 기록이 결정한다. 넘어왔을 때만 손댄다
  if (p.status) {
    o['상태'] = p.status;
    o['완료일'] = (p.status === '완료') ? (p.done || today_()) : '';
  }

  if (creator) {
    o['등록자전화'] = creator;
    if (o['진행률'] === undefined) o['진행률'] = 0;   // 새 업무만 0으로 시작
    if (o['상태'] === undefined) { o['상태'] = '대기'; o['완료일'] = ''; }
  }
  return o;
}

/** 완료된 업무 전체 (진행판에 안 보이는 오래된 건 포함) */
function api_doneAll(token, corp) {
  var me = userInfo_(requireUser_(token));
  var nameOf = nameMap_();
  var typeName = {};
  var _m = meta_();
  (_m.typeAll || _m.types).forEach(function (t) { typeName[t.code] = t.name; });

  var rows = readObjects_('업무')
    .filter(function (t) {
      if (t['상태'] !== '완료') return false;
      if (corp && corp !== 'ALL' && t['법인코드'] !== corp) return false;
      return canSeeTask_(me, t);
    })
    .map(function (t) {
      return {
        id: t['업무ID'], title: t['업무명'],
        done: fmtD_(t['완료일']), amount: Number(t['계약금액'] || 0),
        owner: nameOf[normPhone_(t['담당자전화'])] || '',
        type: typeName[t['유형코드']] || t['유형코드'],
        site: t['현장코드'] || ''
      };
    })
    .sort(function (a, b) { return a.done < b.done ? 1 : -1; });

  // 월별 합계
  var byMonth = {};
  rows.forEach(function (r) {
    var m = (r.done || '').substring(0, 7) || '기타';
    if (!byMonth[m]) byMonth[m] = { month: m, count: 0, amount: 0 };
    byMonth[m].count++; byMonth[m].amount += r.amount;
  });
  var months = Object.keys(byMonth).sort().reverse().map(function (k) { return byMonth[k]; });

  return { ok: true, rows: rows, months: months, ms: took_() };
}

/** 업무일지 삭제 — 관리자는 전부, 직원은 본인이 쓴 기록만 */
function api_deleteLog(token, logId, corp) {
  var me = userInfo_(requireUser_(token));

  var target = null;
  readObjects_('업무일지').forEach(function (l) { if (l['일지ID'] === logId) target = l; });
  if (!target) return { ok: false, msg: '기록을 찾을 수 없습니다.' };
  if (me.grade < 9 && normPhone_(target['작성자전화']) !== me.phone) {
    return { ok: false, msg: '본인이 쓴 기록만 지울 수 있습니다.' };
  }

  var taskId = target['업무ID'];
  deleteRows_('업무일지', [target._row]);

  // 남은 기록을 기준으로 업무의 최근기록일·진행률을 다시 맞춘다
  var rest = readObjects_('업무일지')
    .filter(function (l) { return l['업무ID'] === taskId; })
    .sort(function (a, b) { return fmtD_(a['일자']) < fmtD_(b['일자']) ? -1 : 1; });

  readObjects_('업무').forEach(function (t) {
    if (t['업무ID'] !== taskId) return;
    var upd = { '수정일시': fmtDT_(now_()) };
    if (rest.length) {
      var last = rest[rest.length - 1];
      upd['최근기록일'] = fmtD_(last['일자']);
      var pg = null;
      for (var i = rest.length - 1; i >= 0; i--) {
        var v = rest[i]['진행률'];
        if (v !== '' && v !== null && v !== undefined) { pg = Number(v); break; }
      }
      if (pg !== null) {
        upd['진행률'] = pg;
        if (pg >= 100) { upd['상태'] = '완료'; }
        else if (pg > 0) { upd['상태'] = '진행중'; upd['완료일'] = ''; }
        else { upd['완료일'] = ''; }
      }
    } else {
      upd['최근기록일'] = '';
      upd['진행률'] = 0;
      upd['상태'] = '대기';
      upd['완료일'] = '';
    }
    updateObject_('업무', t._row, upd);
  });

  var res = { ok: true, id: logId, taskId: taskId, ms: took_() };
  log_(me.phone, '기록삭제', logId, token);
  return res;
}

function api_taskDetail(token, id) {
  var u = requireUser_(token);
  var me = userInfo_(u);
  var nameOf = nameMap_();

  var task = null;
  readObjects_('업무').forEach(function (t) { if (t['업무ID'] === id) task = t; });
  if (!task) return { ok: false, msg: '업무를 찾을 수 없습니다.' };
  if (!canSeeTask_(me, task)) return { ok: false, msg: '열람 권한이 없습니다.' };

  var logs = readObjects_('업무일지').filter(function (l) { return l['업무ID'] === id; });
  logs.sort(function (a, b) { return fmtD_(b['일자']) > fmtD_(a['일자']) ? 1 : -1; });

  var docs = readObjects_('결재문서').filter(function (d) { return d['업무ID'] === id; });

  // 정산은 철거에만. 다른 유형에는 null 을 보낸다 (화면에서 가리는 것이 아니다)
  var settleOut = null;
  if (task['유형코드'] === 'DEMO') {
    var settleR = settleRows_(id);
    settleOut = { rows: settleR, sum: settleSummary_(id, settleR) };
  }

  // 댓글은 전부 (board 는 최근 3건만 보내므로 '댓글 더 보기' 가 여기로 온다)
  var cmts = readObjects_('댓글')
    .filter(function (c) { return String(c['대상구분'] || '') === '업무' && c['대상ID'] === id; })
    .map(function (c) { return commentOut_(c, nameOf); })
    .sort(function (a, b) { return a.at < b.at ? -1 : 1; });

  return {
    ok: true,
    settle: settleOut,
    comments: cmts,
    cmtTotal: cmts.length,
    readers: readersOf_('업무', id, nameOf),
    task: {
      id: task['업무ID'], type: task['유형코드'], corp: task['법인코드'],
      title: task['업무명'], content: String(task['내용'] == null ? '' : task['내용']),
      owner: normPhone_(task['담당자전화']),
      ownerName: nameOf[normPhone_(task['담당자전화'])] || '',
      status: task['상태'], start: fmtD_(task['시작예정일']), due: fmtD_(task['마감일']),
      done: fmtD_(task['완료일']), progress: Number(task['진행률'] || 0),
      site: task['현장코드'] || '', addr: task['주소'] || '', tel: task['고객연락처'] || '',
      area: task['면적'] || '', scope: task['작업범위'] || '',
      amount: Number(task['계약금액'] || 0), vat: task['VAT구분'] || ''
    },
    total: logs.length,
    logs: logs.map(function (l) { return logOut_(l, nameOf); }),
    docs: docs.map(function (d) {
      return { no: d['문서번호'], title: d['제목'], amount: Number(d['총금액'] || 0), status: d['상태'] };
    }),
    ms: took_()
  };
}

// =============================================================
//  읽음 표시
//    board_ 는 이 시트를 읽지 않는다. 상세를 열 때만 읽는다.
// =============================================================

/** 이 대상을 읽은 사람 이름 목록 */
function readersOf_(kind, targetId, nameOf) {
  nameOf = nameOf || nameMap_();
  var seen = {}, names = [];
  readObjects_('읽음').forEach(function (r) {
    if (String(r['대상구분'] || '') !== kind) return;
    if (r['대상ID'] !== targetId) return;
    var ph = normPhone_(r['전화번호']);
    if (!ph || seen[ph]) return;
    seen[ph] = true;
    if (nameOf[ph]) names.push(nameOf[ph]);
  });
  return names;
}

/**
 * 업무 상세를 열었다는 표시. 화면은 이걸 기다리지 않는다(왕복 0회로 이미 떠 있다).
 * 이미 읽은 사람이면 시트에 쓰지 않고 목록만 돌려준다.
 * board 를 만들지 않으므로 가볍다 (읽기 2회 · 쓰기 0~1회).
 */
function api_markRead(token, kind, targetId) {
  var me = userInfo_(requireUser_(token));
  if (kind !== '업무' || !targetId) return { ok: false, msg: '대상이 없습니다.' };
  ensureReadSheet_();

  /* 두 가지를 같은 왕복에서 처리한다 (v44).
     · 대상구분 '업무'  — 누가 이 업무를 열어봤는지 (한 번만 남긴다)
     · 대상구분 '댓글'  — 댓글을 어디까지 봤는지 (열 때마다 갱신한다)
     ★ 댓글 배지를 화면 변수에만 두니 새로고침하면 되살아났다. 그래서 시트에 남긴다.
       새 시트를 만들지 않고 이미 있는 '읽음' 시트를 그대로 쓴다. */
  var nowS = fmtDT_(now_());
  var openRow = null, cmtRow = null;
  readObjects_('읽음').forEach(function (r) {
    if (r['대상ID'] !== targetId) return;
    if (normPhone_(r['전화번호']) !== me.phone) return;
    var k = String(r['대상구분'] || '');
    if (k === '업무') openRow = r;
    else if (k === '댓글') cmtRow = r;
  });

  var add = [];
  if (!openRow) {
    add.push({ '대상구분': '업무', '대상ID': targetId, '전화번호': me.phone, '읽은일시': nowS });
  }
  if (cmtRow) updateObject_('읽음', cmtRow._row, { '읽은일시': nowS });   // 보통은 이 한 줄만
  else add.push({ '대상구분': '댓글', '대상ID': targetId, '전화번호': me.phone, '읽은일시': nowS });

  if (add.length) appendObjects_('읽음', add);

  return { ok: true, readers: readersOf_('업무', targetId), ms: took_() };
}

// =============================================================
//  정산 — 계약금액은 정산내역 줄들의 합으로만 결정된다
//    최초견적 + 추가 - 차감 = 공급가
//    입금은 부가세 포함 금액으로 그대로 적는다
// =============================================================

var VAT_RATE = 0.1;

function ensureSettleSheet_() {
  var ss = ss_();
  if (ss.getSheetByName('정산내역')) return;
  var sh = ss.insertSheet('정산내역');
  sh.getRange(1, 1, 1, 9).setValues([['정산ID', '업무ID', '구분', '금액', '사유',
    '일자', '결재문서번호', '세금계산서', '등록자전화']])
    .setFontWeight('bold').setBackground('#F1F3F4');
  sh.setFrozenRows(1);
  sh.setColumnWidth(5, 240);
  delete _VALS['정산내역']; delete _OBJ['정산내역'];
  delete _HEAD['정산내역'];
}

function settleRows_(taskId) {
  ensureSettleSheet_();
  return readObjects_('정산내역')
    .filter(function (r) { return r['업무ID'] === taskId; })
    .sort(function (a, b) { return fmtD_(a['일자']) < fmtD_(b['일자']) ? -1 : 1; })
    .map(function (r) {
      return {
        id: r['정산ID'], kind: r['구분'], amount: Number(r['금액'] || 0),
        memo: r['사유'] || '', date: fmtD_(r['일자']),
        docNo: r['결재문서번호'] || '', tax: r['세금계산서'] || '', _row: r._row
      };
    });
}

function settleSummary_(taskId, rows) {
  rows = rows || settleRows_(taskId);
  var base = 0, add = 0, minus = 0, paid = 0, taxYes = 0, payCnt = 0;
  rows.forEach(function (r) {
    if (r.kind === '최초견적') base += r.amount;
    else if (r.kind === '추가') add += r.amount;
    else if (r.kind === '차감') minus += Math.abs(r.amount);
    else if (r.kind === '입금') {
      paid += r.amount; payCnt++;
      if (String(r.tax).indexOf('발행') >= 0) taxYes++;
    }
  });
  var supply = base + add - minus;              // 공급가 (부가세 별도)
  var vat = Math.round(supply * VAT_RATE);
  var total = supply + vat;                     // 실제 청구액
  return {
    base: base, add: add, minus: minus,
    supply: supply, vat: vat, total: total,
    paid: paid, unpaid: total - paid,
    payCount: payCnt, taxCount: taxYes,
    rate: total > 0 ? Math.round(paid / total * 100) : 0
  };
}

/** 정산내역이 바뀌면 업무의 계약금액(공급가)을 다시 맞춘다 */
function syncTaskAmount_(taskId) {
  var sum = settleSummary_(taskId);
  var target = null;
  readObjects_('업무').forEach(function (t) { if (t['업무ID'] === taskId) target = t; });
  if (!target) return sum;
  if (Number(target['계약금액'] || 0) !== sum.supply) {
    updateObject_('업무', target._row, { '계약금액': sum.supply, 'VAT구분': '별도', '수정일시': fmtDT_(now_()) });
  }
  return sum;
}

/** 업무에 계약금액만 있고 정산내역이 없으면 '최초견적' 줄을 만들어 둔다 */
function seedBaseSettle_(taskId, amount, phone) {
  if (!amount) return;
  try {
    ensureSettleSheet_();
    var has = settleRows_(taskId).some(function (r) { return r.kind === '최초견적'; });
    if (has) return;
    seedBaseWrite_(taskId, amount, phone);
  } catch (e) { /* 정산 줄을 못 만들어도 업무 저장은 성공시킨다 */ }
}

function seedBaseWrite_(taskId, amount, phone) {
  appendObject_('정산내역', {
    '정산ID': nextId_('정산내역', '정산ID', 'S'), '업무ID': taskId, '구분': '최초견적',
    '금액': Number(amount), '사유': '견적 금액', '일자': today_(),
    '결재문서번호': '', '세금계산서': '', '등록자전화': phone || ''
  });
}

/**
 * ★ 시트 구조가 안 맞을 때 편집기에서 실행하세요 ★
 * 없는 시트를 만들고, 계약금액만 있고 정산내역이 없는 업무를 채웁니다.
 */
function 정산_맞추기() {
  점검_지금하기();
  var n = 0;
  readObjects_('업무').forEach(function (t) {
    var id = t['업무ID'];
    var amt = Number(t['계약금액'] || 0);
    if (!id || !amt) return;
    var has = settleRows_(id).some(function (r) { return r.kind === '최초견적'; });
    if (has) return;
    seedBaseWrite_(id, amt, normPhone_(t['담당자전화']));
    n++;
  });
  var msg = '정산내역 시트를 정리했습니다.\n최초견적을 새로 채운 업무: ' + n + '건';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('정산 맞추기', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

function api_settle(token, taskId) {
  var me = userInfo_(requireUser_(token));
  var rows = settleRows_(taskId);
  return { ok: true, rows: rows, sum: settleSummary_(taskId, rows), grade: me.grade, ms: took_() };
}

/**
 * 정산 줄 등록
 *   최초견적 · 차감 : 담당자 또는 관리자
 *   입금            : 임원(3) 이상만
 *   추가            : 여기서 직접 못 넣는다. 반드시 결재를 거친다
 */
function api_addSettle(token, p, corp) {
  var me = userInfo_(requireUser_(token));
  var kind = p.kind;

  if (kind === '추가') {
    return { ok: false, msg: '추가공사는 결재를 거쳐야 합니다. 결재 화면에서 추가공사 승인요청을 올려주세요.' };
  }
  if (['최초견적', '차감', '입금'].indexOf(kind) < 0) {
    return { ok: false, msg: '알 수 없는 구분입니다.' };
  }
  if (kind === '입금' && me.grade < 3) {
    return { ok: false, msg: '입금 등록은 임원·관리자만 가능합니다.' };
  }

  var task = null;
  readObjects_('업무').forEach(function (t) { if (t['업무ID'] === p.taskId) task = t; });
  if (!task) return { ok: false, msg: '업무를 찾을 수 없습니다.' };
  if (task['유형코드'] !== 'DEMO') {
    return { ok: false, msg: '정산은 철거 업무에만 붙습니다.' };
  }
  if (me.grade < 3 && normPhone_(task['담당자전화']) !== me.phone) {
    return { ok: false, msg: '본인 담당 업무만 등록할 수 있습니다.' };
  }

  var amt = Number(p.amount || 0);
  if (!amt || amt <= 0) return { ok: false, msg: '금액을 입력해주세요.' };
  if (kind === '차감') amt = Math.abs(amt);

  appendObject_('정산내역', {
    '정산ID': nextId_('정산내역', '정산ID', 'S'), '업무ID': p.taskId, '구분': kind,
    '금액': amt, '사유': p.memo || '', '일자': p.date || today_(),
    '결재문서번호': '', '세금계산서': p.tax || '', '등록자전화': me.phone
  });

  var sum = syncTaskAmount_(p.taskId);
  var res = { ok: true, sum: sum, rows: settleRows_(p.taskId), taskId: p.taskId, ms: took_() };
  log_(me.phone, '정산등록:' + kind, p.taskId, token);   // 응답을 만든 뒤에
  return res;
}

/** 정산 줄 삭제 — 관리자만 */
function api_deleteSettle(token, settleId, taskId, corp) {
  var me = userInfo_(requireUser_(token));
  if (me.grade < 9) return { ok: false, msg: '관리자만 삭제할 수 있습니다.' };

  var target = null;
  readObjects_('정산내역').forEach(function (r) { if (r['정산ID'] === settleId) target = r; });
  if (!target) return { ok: false, msg: '항목을 찾을 수 없습니다.' };

  deleteRows_('정산내역', [target._row]);
  var sum = syncTaskAmount_(taskId);
  var res = { ok: true, sum: sum, rows: settleRows_(taskId), taskId: taskId, ms: took_() };
  log_(me.phone, '정산삭제', settleId, token);
  return res;
}

// =============================================================
//  API - 업무일지
// =============================================================

function api_saveLog(token, p, corp) {
  var u = requireUser_(token);
  var me = userInfo_(u);

  if (!p.taskId) return { ok: false, msg: '업무를 선택해주세요.' };
  if (!p.text || !String(p.text).trim()) return { ok: false, msg: '작업내용을 입력해주세요.' };
  if (p.next && String(p.next).trim() && !p.nextDate) {
    return { ok: false, msg: '다음 할일을 적으셨으면 일정일도 골라주세요.' };
  }

  var photoUrl = '';
  if (p.photo) photoUrl = savePhoto_(p.photo, p.taskId + '_' + today_());

  var id = nextId_('업무일지', '일지ID', 'L');
  appendObject_('업무일지', {
    '일지ID': id, '일자': p.date || today_(), '업무ID': p.taskId,
    '작성자전화': me.phone, '작업내용': p.text,
    '기공수': p.g || 0, '조공수': p.j || 0,
    '장비': p.eq || '', '장비일수': p.eqd || '',
    '폐기물종류': p.wt || '', '폐기물톤수': p.wton || '', '폐기물차수': p.wcnt || '',
    '진행률': p.progress == null ? '' : Number(p.progress),
    '추가견적필요': p.extra ? 'Y' : '',
    '다음할일': p.next, '다음일정일': p.nextDate,
    '사진링크': photoUrl,
    '작성일시': fmtDT_(now_()), '수정일시': fmtDT_(now_())
  });

  // 업무 진행률·최근기록일 갱신
  var rows = readObjects_('업무');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['업무ID'] === p.taskId) {
      var upd = { '최근기록일': p.date || today_(), '수정일시': fmtDT_(now_()) };

      /* 상태는 진행률이 결정한다
       *   0%        → 대기 유지 (실측·견적·협의 단계)
       *   1~99%     → 진행중
       *   100%      → 완료
       * 진행률을 아예 입력하지 않은 기록은 상태를 건드리지 않는다. */
      if (p.progress != null && p.progress !== '') {
        var pg = Number(p.progress);
        upd['진행률'] = pg;
        if (pg >= 100) {
          upd['상태'] = '완료';
          upd['완료일'] = p.date || today_();
        } else if (pg > 0) {
          upd['상태'] = '진행중';
          upd['완료일'] = '';
        } else {
          if (rows[i]['상태'] === '완료') upd['상태'] = '대기';
          upd['완료일'] = '';
        }
      }
      updateObject_('업무', rows[i]._row, upd);
      break;
    }
  }

  /* 방금 쓴 기록을 그대로 돌려준다. 화면이 이걸로 상세를 즉시 고친다
     (board 를 다시 만들지 않으므로 시트 11회 읽기가 사라진다) */
  var res = {
    ok: true, id: id, taskId: p.taskId,
    log: {
      id: id, date: p.date || today_(), who: me.name, text: p.text,
      g: Number(p.g || 0), j: Number(p.j || 0),
      eq: p.eq || '', eqd: p.eqd || '',
      wt: p.wt || '', wton: Number(p.wton || 0),
      progress: Number(p.progress || 0),
      extra: !!p.extra, next: p.next || '', nextDate: p.nextDate || '',
      photo: photoUrl
    },
    ms: took_()
  };
  if (p.extra) notifyGrade_(3, '추가견적 필요: ' + (p.taskId), p.taskId);   // 응답을 만든 뒤에
  return res;
}

function savePhoto_(dataUrl, baseName) {
  try {
    var folder = attachFolder_();
    var parts = String(dataUrl).split(',');
    var meta = parts[0];
    var type = meta.substring(meta.indexOf(':') + 1, meta.indexOf(';'));
    var ext = type.indexOf('png') >= 0 ? '.png' : '.jpg';
    var blob = Utilities.newBlob(Utilities.base64Decode(parts[1]), type, baseName + ext);
    var t0 = new Date().getTime();
    var f = folder.createFile(blob);
    var url = f.getUrl();
    add_('드라이브:사진올리기', t0);
    // 파일마다 공유 설정을 걸면 드라이브 왕복이 한 번 더 든다.
    // 폴더에 한 번만 걸어두고 파일은 그걸 물려받게 한다 (attachFolder_ 참고)
    return url;
  } catch (e) {
    return '';
  }
}

function attachFolder_() {
  var st = settings_();
  var id = String(st['첨부폴더ID'] || '').trim();
  if (id) {
    try {
      var fo = DriveApp.getFolderById(id);
      shareFolderOnce_(fo, id);
      return fo;
    } catch (e) {}
  }
  var f = DriveApp.createFolder('UNION ONE 워크보드 첨부');
  shareFolderOnce_(f, f.getId());
  setSetting_('첨부폴더ID', f.getId());
  return f;
}

/** 폴더 공유는 평생 한 번만 건다 (파일마다 걸면 드라이브 왕복이 늘어난다) */
function shareFolderOnce_(folder, id) {
  try {
    // 이미 한 번에 가져와둔 속성에서 본다 (v43) — 따로 물으면 왕복이 하나 는다
    if (verAll_()['ATTACH_SHARED'] === id) return;
    var props = PropertiesService.getScriptProperties();
    folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    props.setProperty('ATTACH_SHARED', id);
  } catch (e) {}
}

// =============================================================
//  API - 전자결재
// =============================================================

function pendingDocs_(me, docs, lines, nameOf, proxy) {
  lines = lines || readObjects_('결재선');
  docs = docs || readObjects_('결재문서');
  nameOf = nameOf || nameMap_();
  proxy = proxy || proxyTargets_(me.phone);
  var docMap = {};
  docs.forEach(function (d) { docMap[d['문서번호']] = d; });

  var out = [], seen = {};
  lines.forEach(function (l) {
    if (l['역할'] !== '승인') return;
    if (String(l['상태'] || '대기') !== '대기') return;
    var tp = normPhone_(l['대상전화']);
    var mine = (tp === me.phone);
    if (!mine && !proxy[tp] && me.grade < 9) return; // 내 몫·대리 또는 관리자
    var d = docMap[l['문서번호']];
    if (!d || d['상태'] !== '진행중') return;
    if (seen[d['문서번호']]) return;
    seen[d['문서번호']] = true;
    out.push({
      no: d['문서번호'], title: d['제목'],
      amount: Number(d['총금액'] || 0),
      who: nameOf[normPhone_(d['기안자전화'])] || '',
      at: fmtDT_(d['기안일시']).substring(5),
      proxy: !mine && me.grade < 9
    });
  });
  return out;
}

/**
 * 결재 탭 목록. board_ 가 응답에 같이 실어 보내므로
 * 결재 탭에 들어갈 때 서버에 다시 묻지 않는다.
 * 내 결재선을 문서번호별로 먼저 묶어서 문서 수 × 결재선 수 만큼 훑지 않게 했다.
 */
function docList_(me, docs, lines, nameOf, proxy) {
  var formOf = meta_().forms;
  proxy = proxy || proxyTargets_(me.phone);

  var mineBy = {};
  lines.forEach(function (l) {
    var tp = normPhone_(l['대상전화']);
    var mine = (tp === me.phone);
    var viaProxy = (!mine && !!proxy[tp]);
    if (!mine && !viaProxy) return;
    var no = l['문서번호'];
    if (!mineBy[no]) mineBy[no] = [];
    mineBy[no].push({ l: l, proxy: viaProxy });
  });

  var toAct = [], drafts = [], others = [];
  docs.forEach(function (d) {
    var my = mineBy[d['문서번호']] || [];
    var isDraft = normPhone_(d['기안자전화']) === me.phone;
    if (!isDraft && !my.length && me.grade < 9) return;   // 권한 밖 문서는 안 내려보낸다

    var actLines = my.filter(function (x) {
      return x.l['역할'] === '승인' && String(x.l['상태'] || '대기') === '대기';
    });
    if (me.grade >= 9 && !actLines.length) {
      actLines = lines.filter(function (l) {
        return l['문서번호'] === d['문서번호'] && l['역할'] === '승인' &&
          String(l['상태'] || '대기') === '대기';
      }).map(function (l) { return { l: l, proxy: false }; });
    }
    var fmx = formOf[d['양식코드']];
    var item = {
      no: d['문서번호'], title: d['제목'], corp: d['법인코드'],
      formName: fmx ? fmx.name : d['양식코드'],
      amount: Number(d['총금액'] || 0), status: d['상태'],
      who: nameOf[normPhone_(d['기안자전화'])] || '',
      at: fmtDT_(d['기안일시']),
      canAct: d['상태'] === '진행중' && actLines.length > 0,
      // 내 몫이 아니라 남을 대신해 처리하는 건지
      proxy: actLines.length > 0 && actLines.every(function (x) { return x.proxy; }),
      canRead: my.some(function (x) {
        return x.l['역할'] === '열람' && String(x.l['상태'] || '대기') === '대기' && !x.proxy;
      })
    };
    if (item.canAct) toAct.push(item);
    else if (isDraft) drafts.push(item);
    else others.push(item);
  });

  return { toAct: toAct, drafts: drafts, others: others };
}

function api_docList(token) {
  var me = userInfo_(requireUser_(token));
  var r = docList_(me, readObjects_('결재문서'), readObjects_('결재선'), nameMap_());
  r.ok = true; r.grade = me.grade; r.ms = took_();
  return r;
}

function api_docDetail(token, no) {
  var me = userInfo_(requireUser_(token));
  return docDetail_(no, me, nameMap_(), rankMap_(), proxyTargets_(me.phone));
}

/**
 * 결재 대기 문서 여러 건의 상세를 한 번에.
 * 결재 탭에 들어갈 때 뒤에서 미리 받아두면 문서를 눌러도 기다릴 것이 없다.
 * 여러 건이어도 시트는 요청당 한 번씩만 읽으므로 왕복 1회로 끝난다.
 */
function api_docDetails(token, nos) {
  var me = userInfo_(requireUser_(token));
  var nameOf = nameMap_(), rankOf = rankMap_(), proxy = proxyTargets_(me.phone);
  var out = {};
  (nos || []).slice(0, 10).forEach(function (no) {
    var d = docDetail_(no, me, nameOf, rankOf, proxy);
    if (d && d.ok) out[no] = d;
  });
  return { ok: true, docs: out, ms: took_() };
}

function docDetail_(no, me, nameOf, rankOf, proxy) {
  var doc = null;
  readObjects_('결재문서').forEach(function (d) { if (d['문서번호'] === no) doc = d; });
  if (!doc) return { ok: false, msg: '문서를 찾을 수 없습니다.' };

  return docDetailFrom_(
    doc,
    readObjects_('결재선').filter(function (l) { return l['문서번호'] === no; }),
    readObjects_('결재내역').filter(function (l) { return l['문서번호'] === no; }),
    readObjects_('첨부').filter(function (f) { return f['대상ID'] === no; }),
    readObjects_('문서상세').filter(function (d) { return d['문서번호'] === no; }),
    me, nameOf, rankOf, proxy);
}

/**
 * 이미 읽어둔 줄들로 문서 상세를 만든다.
 * board_ 가 모든 문서 것을 한 번에 만들 때도 이 함수를 쓴다 (시트를 다시 읽지 않는다).
 */
function docDetailFrom_(doc, lines, items, files, detRows, me, nameOf, rankOf, proxy) {
  var det = detRows.slice()
    .sort(function (a, b) { return Number(a['순번'] || 0) - Number(b['순번'] || 0); })
    .map(function (d) { return { name: d['항목명'], value: cellText_(d['값']) }; });
  var fm = meta_().forms[doc['양식코드']];

  return {
    ok: true,
    doc: {
      no: doc['문서번호'], corp: doc['법인코드'], title: doc['제목'],
      formName: fm ? fm.name : doc['양식코드'],
      itemsTitle: fm ? fm.itemsTitle : '내역',
      fields: det,
      who: nameOf[normPhone_(doc['기안자전화'])] || '',
      at: fmtDT_(doc['기안일시']),
      amount: Number(doc['총금액'] || 0), status: doc['상태'], memo: doc['비고'] || '',
      seal: String(doc['도장링크'] || ''),         // 최종 승인 때 시스템이 찍은 법인 도장
      done: fmtDT_(doc['완료일시'])
    },
    // 이 사람이 지금 결재할 수 있는지 — 판정은 서버가 한다 (화면에서 이름 비교 금지)
    canAct: doc['상태'] === '진행중' && lines.some(function (l) {
      if (l['역할'] !== '승인' || String(l['상태'] || '대기') !== '대기') return false;
      var tp = normPhone_(l['대상전화']);
      return tp === me.phone || !!proxy[tp] || me.grade >= 9;
    }),
    proxy: doc['상태'] === '진행중' && lines.some(function (l) {
      if (l['역할'] !== '승인' || String(l['상태'] || '대기') !== '대기') return false;
      var tp = normPhone_(l['대상전화']);
      return tp !== me.phone && !!proxy[tp];
    }),
    lines: lines.map(function (l) {
      var tp = normPhone_(l['대상전화']);
      var actor = normPhone_(l['처리자전화']);
      var byProxy = !!(actor && actor !== tp);
      return {
        seq: l['순번'], role: l['역할'],
        // 대리로 처리했으면 '최원찬(대표이사 대리)' 로 보인다
        name: byProxy
          ? ((nameOf[actor] || '') + '(' + (rankOf[tp] || nameOf[tp] || '') + ' 대리)')
          : (nameOf[tp] || ''),
        byProxy: byProxy,
        state: l['상태'] || '대기', at: fmtDT_(l['처리일시']).substring(5),
        comment: l['의견'] || ''
      };
    }),
    // 열람자 현황 — 누가 봤는지, 언제 봤는지
    viewers: lines.filter(function (l) { return l['역할'] === '열람'; })
      .map(function (l) {
        return {
          name: nameOf[normPhone_(l['대상전화'])] || '',
          done: String(l['상태'] || '대기') !== '대기',
          at: fmtDT_(l['처리일시']).substring(5),
          mine: normPhone_(l['대상전화']) === me.phone
        };
      }),
    items: items.map(function (i) {
      return {
        date: fmtD_(i['사용일자']), memo: i['적요'], kind: i['구분'],
        qty: i['수량'], price: i['단가'], amount: Number(i['금액'] || 0)
      };
    }),
    files: files.map(function (f) { return { name: f['파일명'], url: f['드라이브링크'] }; }),
    ms: took_()
  };
}

function api_saveDoc(token, p, corp) {
  var u = requireUser_(token);
  var me = userInfo_(u);

  var code = p.formCode || 'EXP';
  var form = meta_().forms[code];
  if (!form) return { ok: false, msg: '문서 양식을 찾을 수 없습니다.' };

  if (!p.corp) return { ok: false, msg: '법인을 선택해주세요.' };

  var taskName = '';
  if (code === 'ADD') {
    if (!p.taskId) return { ok: false, msg: '추가공사는 어느 업무인지 반드시 골라야 합니다.' };
    var addTask = null;
    readObjects_('업무').forEach(function (t) { if (t['업무ID'] === p.taskId) addTask = t; });
    if (!addTask) return { ok: false, msg: '업무를 찾을 수 없습니다.' };
    if (addTask['유형코드'] !== 'DEMO') {
      return { ok: false, msg: '추가공사는 철거 업무에만 올릴 수 있습니다.' };
    }
    taskName = String(addTask['업무명'] || '');
  }

  // 양식이 요구하는 항목 검사
  var fields = p.fields || {};
  for (var i = 0; i < form.fields.length; i++) {
    var f = form.fields[i];
    if (f.req && !String(fields[f.name] || '').trim()) {
      return { ok: false, msg: f.name + '을(를) 입력해주세요.' };
    }
  }

  var items = p.items || [];
  var total = 0;
  items.forEach(function (i2) { total += Number(i2.amount || 0); });

  if (form.useItems) {
    if (!items.length) return { ok: false, msg: form.itemsTitle + '을(를) 한 줄 이상 입력해주세요.' };
    if (total <= 0) return { ok: false, msg: '금액을 입력해주세요.' };
  }
  if (form.needReceipt && !p.photo) return { ok: false, msg: '영수증 사진을 첨부해주세요.' };

  /* 제목은 사용자가 적은 것을 그대로 쓴다 (v42).
     작성 창이 자동 제목을 미리 채워 보내므로 보통은 그 값이 온다.
     비어 있으면(옛 화면에서 온 요청 등) 서버가 만들어 채운다 — 제목 없는 문서는 만들지 않는다. */
  var title = String(p.title == null ? '' : p.title).trim();
  if (!title) title = docTitle_(code, form, p, items, total, taskName);
  title = title.substring(0, 120);
  if (!title) return { ok: false, msg: '제목을 입력해주세요.' };

  /* ★ 결재선을 문서보다 먼저 정합니다.
     승인자가 한 명도 없으면 결재선이 빈 문서가 되고, 그런 문서는
     관리자라도 누를 줄이 없어 영영 '진행중' 으로 남습니다.
     양식의 '기본승인자' 가 비어 있으면 여기서 대표 → 관리자 순으로 찾아 채우고,
     그래도 못 찾으면 문서를 아예 만들지 않습니다.
     (문서를 만든 뒤에 막으면 주인 없는 줄이 시트에 남습니다) */
  var approvers = [], viewers = [];
  String(form.approvers || '').split(',').forEach(function (ph) {
    ph = normPhone_(ph); if (!ph) return;
    if (approvers.indexOf(ph) < 0) approvers.push(ph);
  });
  if (!approvers.length) approvers = fallbackApprovers_();
  if (!approvers.length) {
    return { ok: false, msg: '결재선을 정할 수 없습니다. 설정에서 대표 직급이나 관리자를 먼저 지정해주세요.' };
  }
  String(form.viewers || '').split(',').forEach(function (ph) {
    ph = normPhone_(ph); if (!ph) return;
    if (approvers.indexOf(ph) >= 0) return;       // 승인자와 겹치면 열람은 넣지 않는다
    if (viewers.indexOf(ph) < 0) viewers.push(ph);
  });

  var no = nextId_('결재문서', '문서번호', code);
  var nowS = fmtDT_(now_());

  /* 인감이 찍힌 문서가 필요하다고 체크했으면 날인 품의서를 같이 만든다.
     시트마다 한 번씩만 쓰도록 두 문서의 줄을 모아서 넣는다. */
  var sealNo = '';
  var needSeal = !!p.needSeal && code !== 'SEAL';
  if (needSeal) sealNo = nextId_('결재문서', '문서번호', 'SEAL');

  var docRows = [{
    '문서번호': no, '법인코드': p.corp, '양식코드': code, '제목': title,
    '기안자전화': me.phone, '기안일시': nowS, '업무ID': p.taskId || '',
    '총금액': total, '상태': '진행중', '현재순번': 1, '비고': p.memo || '', '도장링크': ''
  }];
  if (needSeal) {
    docRows.push({
      '문서번호': sealNo, '법인코드': p.corp, '양식코드': 'SEAL',
      '제목': title + ' 인감 날인',
      '기안자전화': me.phone, '기안일시': nowS, '업무ID': p.taskId || '',
      '총금액': 0, '상태': '진행중', '현재순번': 1,
      '비고': '원문서 ' + no, '도장링크': ''
    });
  }
  appendObjects_('결재문서', docRows);

  var lines = [];
  function addLines_(docNo) {
    var seq = 1;
    approvers.forEach(function (ph) {
      lines.push({ '문서번호': docNo, '순번': seq++, '역할': '승인', '대상전화': ph, '상태': '대기' });
    });
    viewers.forEach(function (ph) {
      lines.push({ '문서번호': docNo, '순번': seq++, '역할': '열람', '대상전화': ph, '상태': '대기' });
    });
  }
  addLines_(no);
  if (needSeal) addLines_(sealNo);                // 같은 결재선을 그대로 쓴다
  appendObjects_('결재선', lines);

  if (items.length) {
    var n = 1;
    appendObjects_('결재내역', items.map(function (i3) {
      return {
        '문서번호': no, '순번': n++, '사용일자': i3.date || today_(),
        '적요': i3.memo || '', '구분': i3.kind || '',
        '수량': i3.qty || '', '단가': i3.price || '', '금액': Number(i3.amount || 0),
        '증빙': form.needReceipt ? '영수증' : ''
      };
    }));
  }

  // 양식별 항목값 저장 (두 문서 것을 한 번에)
  var det = [];
  form.fields.forEach(function (f, idx) {
    var v = String(fields[f.name] == null ? '' : fields[f.name]).trim();
    if (v) det.push({ '문서번호': no, '항목명': f.name, '값': v, '순번': idx + 1 });
  });
  if (needSeal) {
    det.push({ '문서번호': sealNo, '항목명': '인감종류', '값': '사용인감', '순번': 1 });
    det.push({ '문서번호': sealNo, '항목명': '날인 문서명', '값': title, '순번': 2 });
  }
  appendObjects_('문서상세', det);

  if (p.photo) {
    var url = savePhoto_(p.photo, no);
    if (url) {
      appendObject_('첨부', {
        '첨부ID': no + '-1', '대상구분': '결재', '대상ID': no,
        '파일명': form.needReceipt ? '영수증' : '첨부',
        '드라이브링크': url, '업로더전화': me.phone, '업로드일시': nowS
      });
    }
  }

  /* 상신은 저장까지만 하고 바로 응답한다.
     board 재계산(시트 11회 읽기)·알림·로그는 응답을 다 만든 뒤로 미룬다.
     화면은 이 응답만으로 결재 목록을 먼저 갱신하고, 진짜 데이터는 뒤에서 받는다. */
  var res = {
    ok: true, no: no, title: title, sealNo: sealNo,
    corp: p.corp, formName: form.name, formCode: code,
    amount: total, at: nowS, who: me.name,
    sealTitle: needSeal ? (title + ' 인감 날인') : '',
    ms: took_()
  };

  // 알림·로그는 응답을 다 만든 뒤에 (알림 시트 쓰기 1회)
  var notis = [];
  approvers.forEach(function (ph) {
    notis.push({ phone: ph, kind: '결재', text: form.name + ' 결재 요청 · ' + title });
  });
  viewers.forEach(function (ph) {
    notis.push({ phone: ph, kind: '열람', text: form.name + ' 열람 요청 · ' + title });
  });
  notifyList_(notis, no);
  log_(me.phone, '결재상신', no, token);
  return res;
}

/**
 * 승인 완료된 결재 문서를 PDF 로 만들어 드라이브에 저장하고 링크를 돌려준다.
 * 무거운 작업이라 미리 만들지 않는다. [문서 보기] 를 누를 때만 만들고,
 * 한 번 만든 것은 '첨부' 시트에 남겨 다시 쓴다. board_ 와는 아무 상관이 없다.
 */
function api_docPdf(token, no) {
  var me = userInfo_(requireUser_(token));

  var doc = null;
  readObjects_('결재문서').forEach(function (d) { if (d['문서번호'] === no) doc = d; });
  if (!doc) return { ok: false, msg: '문서를 찾을 수 없습니다.' };
  if (String(doc['상태'] || '') !== '승인완료') {
    return { ok: false, msg: '승인이 끝난 문서만 만들 수 있습니다.' };
  }

  // 이미 만들어 둔 것이 있으면 그대로 쓴다
  var made = null;
  readObjects_('첨부').forEach(function (f) {
    if (f['대상ID'] === no && String(f['파일명'] || '') === '결재문서') made = f;
  });
  if (made && String(made['드라이브링크'] || '')) {
    return { ok: true, url: String(made['드라이브링크']), cached: true, ms: took_() };
  }

  var nameOf = nameMap_();
  var rankOf = {};
  readObjects_('직원').forEach(function (r) {
    rankOf[normPhone_(r['전화번호'])] = String(r['직급'] || '');
  });

  var m = meta_();
  var fm = m.forms[doc['양식코드']];
  var corpName = doc['법인코드'];
  m.corps.forEach(function (c) { if (c.code === doc['법인코드']) corpName = c.name; });

  var lines = readObjects_('결재선').filter(function (l) { return l['문서번호'] === no; })
    .sort(function (a, b) { return Number(a['순번'] || 0) - Number(b['순번'] || 0); });
  var items = readObjects_('결재내역').filter(function (l) { return l['문서번호'] === no; })
    .sort(function (a, b) { return Number(a['순번'] || 0) - Number(b['순번'] || 0); });
  var det = readObjects_('문서상세').filter(function (d) { return d['문서번호'] === no; })
    .sort(function (a, b) { return Number(a['순번'] || 0) - Number(b['순번'] || 0); });

  var html = docPdfHtml_(doc, corpName, fm, det, items, lines, nameOf, rankOf,
                         String(m.settings['회사명'] || 'UNION ONE'));

  var url = '';
  try {
    var blob = Utilities.newBlob(html, 'text/html', no + '.html')
      .getAs('application/pdf').setName(no + '.pdf');
    var file = attachFolder_().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    url = file.getUrl();
  } catch (e) {
    return { ok: false, msg: '문서를 만들지 못했습니다. 잠시 뒤 다시 눌러주세요.' };
  }

  var nowS = fmtDT_(now_());
  if (made) {
    updateObject_('첨부', made._row, { '드라이브링크': url, '업로드일시': nowS });
  } else {
    appendObject_('첨부', {
      '첨부ID': no + '-DOC', '대상구분': '결재', '대상ID': no, '파일명': '결재문서',
      '드라이브링크': url, '업로더전화': me.phone, '업로드일시': nowS
    });
  }

  var res = { ok: true, url: url, cached: false, ms: took_() };
  log_(me.phone, '문서생성', no, token);
  return res;
}

/** PDF 로 구울 결재 문서 한 장 */
function docPdfHtml_(doc, corpName, fm, det, items, lines, nameOf, rankOf, company) {
  function e_(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var rows = '';
  det.forEach(function (d) {
    rows += '<tr><th>' + e_(d['항목명']) + '</th><td>' + e_(cellText_(d['값'])) + '</td></tr>';
  });

  var itemHtml = '';
  if (items.length) {
    var sum = 0;
    var tr = '';
    items.forEach(function (i) {
      var amt = Number(i['금액'] || 0); sum += amt;
      tr += '<tr><td>' + e_(fmtD_(i['사용일자'])) + '</td><td>' + e_(i['적요']) +
            '</td><td class="r">' + won_(amt) + '</td></tr>';
    });
    itemHtml =
      '<h3>' + e_(fm ? fm.itemsTitle : '내역') + '</h3>' +
      '<table class="grid"><thead><tr><th>일자</th><th>적요</th><th class="r">금액</th></tr></thead>' +
      '<tbody>' + tr + '</tbody>' +
      '<tfoot><tr><td colspan="2" class="r">합계</td><td class="r">' + won_(sum) + '원</td></tr></tfoot>' +
      '</table>';
  }

  var lineHtml = '';
  var approvedAt = '', approvedRank = '';
  lines.forEach(function (l) {
    var ph = normPhone_(l['대상전화']);
    var st = String(l['상태'] || '대기');
    var at = fmtDT_(l['처리일시']);
    if (l['역할'] === '승인' && st === '승인' && at > approvedAt) {
      approvedAt = at; approvedRank = rankOf[ph] || '';
    }
    lineHtml += '<tr><td>' + e_(l['역할']) + '</td><td>' + e_(nameOf[ph] || '') +
                '</td><td>' + e_(rankOf[ph] || '') + '</td><td>' + e_(st) +
                '</td><td>' + e_(at) + '</td></tr>';
  });

  var sealUrl = String(doc['도장링크'] || '');
  var stampLine = approvedAt
    ? (approvedAt.substring(0, 10) + ' ' + (approvedRank || '') + ' 승인')
    : '';

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:"Malgun Gothic","맑은 고딕",sans-serif;font-size:12px;color:#111;padding:34px 30px}' +
    'h1{font-size:20px;margin:0 0 2px;letter-spacing:2px}' +
    'h3{font-size:13px;margin:22px 0 6px;border-bottom:1px solid #999;padding-bottom:4px}' +
    '.head{display:flex;justify-content:space-between;align-items:flex-start;' +
    'border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:16px}' +
    '.meta{font-size:11px;color:#555;line-height:1.7;text-align:right}' +
    'table{width:100%;border-collapse:collapse;margin:0}' +
    'table.kv th{width:120px;text-align:left;background:#F2F2F2;font-weight:600}' +
    'table.kv th,table.kv td{border:1px solid #BBB;padding:7px 9px;vertical-align:top}' +
    'table.grid th,table.grid td{border:1px solid #BBB;padding:7px 9px}' +
    'table.grid thead th{background:#F2F2F2}' +
    'table.grid tfoot td{background:#FAFAFA;font-weight:700}' +
    '.r{text-align:right}' +
    '.stamp{margin-top:26px;display:flex;justify-content:flex-end;align-items:center;gap:14px}' +
    '.stamp .txt{font-size:13px;font-weight:700}' +
    '.stamp img{width:96px;height:96px;object-fit:contain}' +
    '</style></head><body>' +
    '<div class="head"><div><h1>' + e_(fm ? fm.name : doc['양식코드']) + '</h1>' +
    '<div style="font-size:14px;font-weight:700;margin-top:6px">' + e_(doc['제목']) + '</div></div>' +
    '<div class="meta">' + e_(company) + '<br>' + e_(corpName) + '<br>' +
    e_(doc['문서번호']) + '</div></div>' +
    '<table class="kv">' +
    '<tr><th>기안자</th><td>' + e_(nameOf[normPhone_(doc['기안자전화'])] || '') + '</td></tr>' +
    '<tr><th>기안일</th><td>' + e_(fmtDT_(doc['기안일시'])) + '</td></tr>' +
    rows +
    (doc['비고'] ? '<tr><th>비고</th><td>' + e_(doc['비고']) + '</td></tr>' : '') +
    '</table>' +
    itemHtml +
    '<h3>결재선</h3>' +
    '<table class="grid"><thead><tr><th>역할</th><th>이름</th><th>직급</th><th>상태</th><th>처리일시</th></tr></thead>' +
    '<tbody>' + lineHtml + '</tbody></table>' +
    '<div class="stamp">' +
    (stampLine ? '<span class="txt">' + e_(stampLine) + '</span>' : '') +
    (sealUrl ? '<img src="' + e_(sealUrl) + '">' : '') +
    '</div></body></html>';
}

/**
 * 결재 제목을 서버가 만든다 (작성 창에 제목 칸이 없다).
 * 비는 부분은 빼고 만들고, 끝내 비면 양식명을 쓴다.
 */
/**
 * 자동 제목.
 *
 * ★ v42부터 이건 '미리 채워 넣는 값' 이지 최종 제목이 아니다.
 *   작성 창에 제목 칸이 다시 생겼고, 사용자가 고치면 고친 것이 저장된다.
 *   여기는 사용자가 제목을 비워 보냈을 때의 대비책이다.
 *   (자동 생성만 남겼더니 '지출 57,680원 · 콩나물 350g' 처럼 첫 품목만 남아
 *    무슨 지출인지 알 수 없었다. 그 판단이 틀렸다.)
 */
function docTitle_(code, form, p, items, total, taskName) {
  var f = p.fields || {};
  var money = total ? (won_(total) + '원') : '';
  var first = items.length ? String(items[0].memo || '').trim() : '';
  // 품목이 2개 이상이면 몇 건인지 붙인다 ('콩나물 350g 외 4건')
  var more = items.length > 1 ? ('외 ' + (items.length - 1) + '건') : '';
  var t = '';

  function join_(arr, sep) {
    return arr.filter(function (x) { return x && String(x).trim(); }).join(sep);
  }

  if (code === 'EXP' || code === 'PUR') {
    var head = (code === 'EXP') ? '지출' : '구매';
    t = join_([join_([head, money], ' '), join_([first, more], ' ')], ' · ');
  } else if (code === 'ADD') {
    t = join_([taskName, join_(['추가공사', money], ' ')], ' ');
  } else if (code === 'SEAL') {
    t = join_([String(f['날인 문서명'] || ''), '인감 날인'], ' ');
  } else if (code === 'LEAVE') {
    var s = fmtD_(f['시작일']);
    var e = fmtD_(f['종료일']) || s;
    var span = '';
    if (s) span = (e && e !== s) ? (s.substring(5) + '~' + e.substring(5)) : s.substring(5);
    t = join_([String(f['휴가종류'] || ''), span], ' ');
  } else {
    t = join_([form.name, money, first], ' · ');
  }

  t = String(t).trim();
  return t || form.name || code;
}

/**
 * 열람 확인 — 결재선의 '열람' 줄을 '확인' 으로 바꾼다.
 * (승인이 아니므로 문서 상태는 건드리지 않는다)
 */
function api_readDoc(token, no, corp) {
  var me = userInfo_(requireUser_(token));

  var target = null;
  readObjects_('결재선').forEach(function (l) {
    if (l['문서번호'] === no && l['역할'] === '열람' &&
        normPhone_(l['대상전화']) === me.phone && String(l['상태'] || '대기') === '대기') {
      target = l;
    }
  });
  if (!target) return { ok: false, msg: '열람 확인할 문서가 아니거나 이미 확인하셨습니다.' };

  updateObject_('결재선', target._row, {
    '상태': '확인', '처리일시': fmtDT_(now_())
  });

  var res = { ok: true, no: no, ms: took_() };
  log_(me.phone, '열람확인', no, token);
  return res;
}

function api_actDoc(token, no, action, comment, corp) {
  var u = requireUser_(token);
  var me = userInfo_(u);

  /* 내 몫의 결재선을 먼저 찾고, 없으면 내가 대리인으로 지정된 사람의 줄을 찾는다.
     대리로 처리하면 실제로 누른 사람을 '처리자전화' 에 남긴다 (의견 칸은 건드리지 않는다) */
  var proxy = proxyTargets_(me.phone);
  var lines = readObjects_('결재선');
  var target = null, byProxy = false;
  lines.forEach(function (l) {
    if (l['문서번호'] !== no || l['역할'] !== '승인') return;
    if (String(l['상태'] || '대기') !== '대기') return;
    var tp = normPhone_(l['대상전화']);
    if (tp === me.phone) { target = l; byProxy = false; }
    else if (!target && me.grade >= 9) { target = l; byProxy = false; }
    else if (!target && proxy[tp]) { target = l; byProxy = true; }
  });
  if (!target) return { ok: false, msg: '결재 권한이 없거나 이미 처리된 문서입니다.' };

  updateObject_('결재선', target._row, {
    '상태': action === 'approve' ? '승인' : '반려',
    '처리일시': fmtDT_(now_()),
    '의견': comment || '',
    '처리자전화': byProxy ? me.phone : ''
  });

  var rest = readObjects_('결재선').filter(function (l) {
    return l['문서번호'] === no && l['역할'] === '승인' && String(l['상태'] || '대기') === '대기';
  });

  var docRow = null;
  readObjects_('결재문서').forEach(function (d) { if (d['문서번호'] === no) docRow = d; });
  var newStatus = docRow ? String(docRow['상태'] || '') : '';
  var sealed = false;
  if (docRow) {
    if (action === 'reject') {
      updateObject_('결재문서', docRow._row, { '상태': '반려', '완료일시': fmtDT_(now_()) });
      newStatus = '반려';
      notify_(normPhone_(docRow['기안자전화']), '결재', no, '반려되었습니다: ' + docRow['제목']);
    } else if (!rest.length) {
      // 최종 승인 — 이 순간 시스템이 법인 도장을 찍는다 (사람이 찍지 않는다)
      var seal = signMap_()[String(docRow['법인코드'] || '')] || '';
      newStatus = '승인완료';
      sealed = !!seal;
      updateObject_('결재문서', docRow._row, {
        '상태': '승인완료', '완료일시': fmtDT_(now_()), '도장링크': seal
      });
      notify_(normPhone_(docRow['기안자전화']), '결재', no, '승인되었습니다: ' + docRow['제목']);

      // 이 문서에 딸린 인감 날인 품의서도 같이 승인 처리한다 (두 번 승인하지 않게)
      if (docRow['양식코드'] !== 'SEAL') approveLinkedSeal_(no, seal);

      // 추가공사 승인요청이면 정산내역에 '추가' 줄을 자동으로 남긴다
      if (docRow['양식코드'] === 'ADD' && docRow['업무ID']) {
        var already = settleRows_(docRow['업무ID']).some(function (r) { return r.docNo === no; });
        if (!already) {
          appendObject_('정산내역', {
            '정산ID': nextId_('정산내역', '정산ID', 'S'),
            '업무ID': docRow['업무ID'], '구분': '추가',
            '금액': Number(docRow['총금액'] || 0),
            '사유': docRow['제목'] || '추가공사',
            '일자': today_(), '결재문서번호': no, '세금계산서': '',
            '등록자전화': normPhone_(docRow['기안자전화'])
          });
          syncTaskAmount_(docRow['업무ID']);
        }
      }

      // 휴가 신청서가 최종 승인되면 '휴가' 시트에 한 줄 남긴다
      if (docRow['양식코드'] === 'LEAVE') addLeave_(docRow, no);
    }
  }

  /* 승인은 저장까지만 하고 바로 응답한다.
     board 재계산(시트 11회 읽기)·알림·로그는 응답 뒤로 미룬다.
     화면은 이 요약만으로 목록을 고치고, 진짜 데이터는 뒤에서 받는다. */
  var res = {
    ok: true, no: no,
    status: newStatus,
    final: newStatus === '승인완료',
    sealed: sealed,
    proxy: byProxy,
    ms: took_()
  };
  log_(me.phone, action === 'approve' ? '승인' : '반려', no, token);
  return res;
}

/**
 * 원문서가 최종 승인되면 딸린 인감 날인 품의서도 같이 승인 처리.
 * 결재선 줄들은 구간으로 묶지 못하므로 한 줄씩 쓰지만, 보통 승인자는 한 명이다.
 */
function approveLinkedSeal_(parentNo, seal) {
  try {
    var mark = '원문서 ' + parentNo;
    var sealDoc = null;
    readObjects_('결재문서').forEach(function (d) {
      if (d['양식코드'] !== 'SEAL') return;
      if (String(d['상태'] || '') !== '진행중') return;
      if (String(d['비고'] || '').indexOf(mark) < 0) return;
      sealDoc = d;
    });
    if (!sealDoc) return;

    var nowS = fmtDT_(now_());
    readObjects_('결재선').forEach(function (l) {
      if (l['문서번호'] !== sealDoc['문서번호']) return;
      if (l['역할'] !== '승인' || String(l['상태'] || '대기') !== '대기') return;
      updateObject_('결재선', l._row, {
        '상태': '승인', '처리일시': nowS, '의견': '원문서 승인과 함께 처리'
      });
    });
    updateObject_('결재문서', sealDoc._row, {
      '상태': '승인완료', '완료일시': nowS, '도장링크': seal || ''
    });
  } catch (e) { /* 원문서 승인 자체는 성공시킨다 */ }
}

/** 승인된 휴가 신청서를 '휴가' 시트에 적립 (같은 문서번호가 이미 있으면 건너뛴다) */
function addLeave_(docRow, no) {
  try {
    ensureLeaveSheet_();
    var dup = readObjects_('휴가').some(function (r) { return String(r['문서번호']) === no; });
    if (dup) return;

    var det = {};
    readObjects_('문서상세').forEach(function (d) {
      if (d['문서번호'] === no) det[String(d['항목명'])] = cellText_(d['값']);
    });

    var kind = det['휴가종류'] || '';
    var from = fmtD_(det['시작일']);
    var to = fmtD_(det['종료일']) || from;
    if (!from) return;
    if (to < from) to = from;

    var days = (kind.indexOf('반차') >= 0) ? 0.5 : (daysBetween_(from, to) + 1);
    if (!(days > 0)) days = 1;

    var phone = normPhone_(docRow['기안자전화']);
    appendObject_('휴가', {
      '휴가ID': nextId_('휴가', '휴가ID', 'V'),
      '전화번호': phone,
      '이름': nameMap_()[phone] || '',
      '휴가종류': kind,
      '시작일': from, '종료일': to, '일수': days,
      '문서번호': no, '승인일시': fmtDT_(now_())
    });
  } catch (e) { /* 휴가 적립이 실패해도 승인 자체는 성공시킨다 */ }
}

// =============================================================
//  API - 게시판 / 댓글
//    공지 3줄과 업무 댓글은 board_ 가 실어 보낸다 (왕복 0회).
//    게시글 전체 목록만 게시판을 열 때 여기서 1회 가져간다.
// =============================================================

/** 게시판을 열 때 딱 한 번. 글 본문과 댓글까지 같이 보내서 글을 눌러도 왕복이 없다 */
function api_posts(token) {
  var me = userInfo_(requireUser_(token));
  var nameOf = nameMap_();

  var rows = readObjects_('게시글').filter(function (p) { return p['글번호']; });
  rows.sort(function (a, b) {
    var da = fmtDT_(a['작성일시']), db = fmtDT_(b['작성일시']);
    if (da !== db) return da < db ? 1 : -1;      // 최신이 위로
    return b._row - a._row;
  });
  if (rows.length > 100) rows = rows.slice(0, 100);   // 최근 100건만 (그 이상은 시트에서)

  var keep = {};
  var posts = rows.map(function (p) {
    var no = p['글번호'];
    keep[no] = true;
    return {
      no: no, kind: String(p['종류'] || '일반'), corp: p['법인코드'] || '',
      title: p['제목'], body: String(p['내용'] == null ? '' : p['내용']),
      who: nameOf[normPhone_(p['작성자전화'])] || '', phone: normPhone_(p['작성자전화']),
      at: fmtDT_(p['작성일시']), edited: fmtDT_(p['수정일시'])
    };
  });

  var byPost = {};
  readObjects_('댓글').forEach(function (c) {
    if (String(c['대상구분'] || '') !== '게시글') return;
    var pid = c['대상ID'];
    if (!keep[pid]) return;
    if (!byPost[pid]) byPost[pid] = [];
    byPost[pid].push(commentOut_(c, nameOf));
  });
  Object.keys(byPost).forEach(function (pid) {
    byPost[pid].sort(function (a, b) { return a.at < b.at ? -1 : 1; });   // 오래된 순
  });

  return { ok: true, posts: posts, comments: byPost, grade: me.grade, ms: took_() };
}

/** 글 등록·수정. 공지는 전 직원 알림 + 로그를 남긴다 */
function api_savePost(token, p, corp) {
  var me = userInfo_(requireUser_(token));
  ensurePostSheets_();

  var kind = (p.kind === '공지') ? '공지' : '일반';
  var title = String(p.title || '').trim();
  var body = String(p.body || '').trim();
  if (!title) return { ok: false, msg: '제목을 입력해주세요.' };
  if (!body) return { ok: false, msg: '내용을 입력해주세요.' };

  var nowS = fmtDT_(now_());

  if (p.no) {
    var target = null;
    readObjects_('게시글').forEach(function (r) { if (r['글번호'] === p.no) target = r; });
    if (!target) return { ok: false, msg: '글을 찾을 수 없습니다.' };
    if (me.grade < 9 && normPhone_(target['작성자전화']) !== me.phone) {
      return { ok: false, msg: '본인이 쓴 글만 수정할 수 있습니다.' };
    }
    updateObject_('게시글', target._row, {
      '종류': kind, '법인코드': p.corp || '', '제목': title, '내용': body,
      '수정일시': nowS, '만료일': p.expire || ''
    });
    var eres = { ok: true, no: p.no, at: fmtDT_(target['작성일시']), who: me.name,
                 ms: took_() };
    log_(me.phone, kind === '공지' ? '공지수정' : '게시글수정', p.no, token);
    return eres;
  }

  var no = nextId_('게시글', '글번호', kind === '공지' ? 'NT' : 'PS');
  appendObject_('게시글', {
    '글번호': no, '종류': kind, '법인코드': p.corp || '',
    '제목': title, '내용': body,
    '작성자전화': me.phone, '작성일시': nowS, '수정일시': '',
    '만료일': p.expire || ''
  });

  var res = { ok: true, no: no, at: nowS, who: me.name, ms: took_() };

  // 알림·로그는 응답을 다 만든 뒤에 (알림 시트 쓰기 1회)
  if (kind === '공지') {
    var all = [];
    readObjects_('직원').forEach(function (r) {
      if (r['재직상태'] === '퇴사') return;
      var ph = normPhone_(r['전화번호']);
      if (ph && ph !== me.phone) all.push(ph);
    });
    notifyMany_(all, '공지', no, '공지 · ' + title + ' (' + me.name + ')');
  }
  log_(me.phone, kind === '공지' ? '공지등록' : '게시글등록', no, token);
  return res;
}

/** 글 삭제 — 본인 글 또는 관리자. 달린 댓글도 함께 지운다 */
function api_deletePost(token, no, corp) {
  var me = userInfo_(requireUser_(token));

  var target = null;
  readObjects_('게시글').forEach(function (r) { if (r['글번호'] === no) target = r; });
  if (!target) return { ok: false, msg: '글을 찾을 수 없습니다.' };
  if (me.grade < 9 && normPhone_(target['작성자전화']) !== me.phone) {
    return { ok: false, msg: '본인이 쓴 글만 지울 수 있습니다.' };
  }

  deleteRows_('댓글', readObjects_('댓글')
    .filter(function (c) { return String(c['대상구분'] || '') === '게시글' && c['대상ID'] === no; })
    .map(function (c) { return c._row; }));
  deleteRows_('게시글', [target._row]);

  var res = { ok: true, no: no, ms: took_() };
  log_(me.phone, '게시글삭제', no, token);
  return res;
}

/**
 * 댓글 등록 — 업무 상세와 게시글 두 군데에서 쓴다.
 *   업무   : 볼 권한이 있어야 남길 수 있고, 담당자·협업자에게 알림 (본인 제외)
 *   게시글 : 글 작성자에게 알림 (본인 제외)
 */
function api_saveComment(token, kind, targetId, text, corp) {
  var me = userInfo_(requireUser_(token));
  ensurePostSheets_();

  var body = String(text || '').trim();
  if (!body) return { ok: false, msg: '내용을 입력해주세요.' };
  if (!targetId) return { ok: false, msg: '대상을 찾을 수 없습니다.' };
  if (kind !== '업무' && kind !== '게시글') return { ok: false, msg: '알 수 없는 대상입니다.' };

  var notify = [], head = '';

  if (kind === '업무') {
    var task = null;
    readObjects_('업무').forEach(function (t) { if (t['업무ID'] === targetId) task = t; });
    if (!task) return { ok: false, msg: '업무를 찾을 수 없습니다.' };
    if (!canSeeTask_(me, task)) return { ok: false, msg: '댓글을 남길 권한이 없습니다.' };
    head = String(task['업무명'] || '');
    var own = normPhone_(task['담당자전화']);
    if (own && own !== me.phone) notify.push(own);
    String(task['협업자전화'] || '').split(',').forEach(function (ph) {
      ph = normPhone_(ph);
      if (ph && ph !== me.phone && notify.indexOf(ph) < 0) notify.push(ph);
    });
  } else {
    var post = null;
    readObjects_('게시글').forEach(function (r) { if (r['글번호'] === targetId) post = r; });
    if (!post) return { ok: false, msg: '글을 찾을 수 없습니다.' };
    head = String(post['제목'] || '');
    var au = normPhone_(post['작성자전화']);
    if (au && au !== me.phone) notify.push(au);
  }

  var nowS = fmtDT_(now_());
  var id = 'C' + new Date().getTime() + Math.floor(Math.random() * 100);
  appendObject_('댓글', {
    '댓글ID': id, '대상구분': kind, '대상ID': targetId,
    '작성자전화': me.phone, '내용': body, '작성일시': nowS
  });

  var res = {
    ok: true,
    comment: { id: id, kind: kind, target: targetId, who: me.name, phone: me.phone,
               text: body, at: nowS },
    ms: took_()
  };

  // 알림은 응답을 다 만든 뒤에
  if (notify.length) {
    notifyMany_(notify, '댓글', targetId,
      me.name + '님 댓글 · ' + head.substring(0, 20) + ' : ' + body.substring(0, 30));
  }
  return res;
}

/** 댓글 삭제 — 본인 댓글 또는 관리자 */
function api_deleteComment(token, id, corp) {
  var me = userInfo_(requireUser_(token));

  var target = null;
  readObjects_('댓글').forEach(function (c) { if (c['댓글ID'] === id) target = c; });
  if (!target) return { ok: false, msg: '댓글을 찾을 수 없습니다.' };
  if (me.grade < 9 && normPhone_(target['작성자전화']) !== me.phone) {
    return { ok: false, msg: '본인이 쓴 댓글만 지울 수 있습니다.' };
  }

  deleteRows_('댓글', [target._row]);
  var res = { ok: true, id: id, ms: took_() };
  log_(me.phone, '댓글삭제', id, token);
  return res;
}

// =============================================================
//  알림
// =============================================================

function notify_(phone, kind, targetId, text) {
  if (!phone) return;
  appendObject_('알림', {
    '알림ID': 'N' + new Date().getTime() + Math.floor(Math.random() * 100),
    '대상전화': normPhone_(phone), '유형': kind, '대상ID': targetId,
    '내용': text, '생성일시': fmtDT_(now_()), '읽음일시': ''
  });
}

/** 사람마다 문구가 다른 알림을 한 번에 (쓰기 1번) */
function notifyList_(list, targetId) {
  var nowS = fmtDT_(now_());
  var base = new Date().getTime();
  var rows = [];
  (list || []).forEach(function (n, i) {
    var ph = normPhone_(n.phone);
    if (!ph) return;
    rows.push({
      '알림ID': 'N' + (base + i), '대상전화': ph, '유형': n.kind || '알림',
      '대상ID': targetId || '', '내용': n.text, '생성일시': nowS, '읽음일시': ''
    });
  });
  appendObjects_('알림', rows);
}

/** 여러 명에게 한 번에 알림 (쓰기 1번) */
function notifyMany_(phones, kind, targetId, text) {
  var nowS = fmtDT_(now_());
  var base = new Date().getTime();
  var rows = [];
  (phones || []).forEach(function (ph, i) {
    ph = normPhone_(ph);
    if (!ph) return;
    rows.push({
      '알림ID': 'N' + (base + i), '대상전화': ph, '유형': kind, '대상ID': targetId,
      '내용': text, '생성일시': nowS, '읽음일시': ''
    });
  });
  appendObjects_('알림', rows);
}

function notifyGrade_(grade, text, targetId) {
  var list = [];
  readObjects_('직원').forEach(function (r) {
    if (Number(r['권한등급'] || 1) >= grade) list.push(r['전화번호']);
  });
  notifyMany_(list, '알림', targetId, text);
}

/** 결재문서 삭제 — 관리자(등급 9) 전용. 딸린 결재선·내역·첨부도 함께 지움 */
function api_deleteDoc(token, no, corp) {
  var me = userInfo_(requireUser_(token));
  if (me.grade < 9) return { ok: false, msg: '관리자만 삭제할 수 있습니다.' };

  var doc = null;
  readObjects_('결재문서').forEach(function (d) { if (d['문서번호'] === no) doc = d; });
  if (!doc) return { ok: false, msg: '문서를 찾을 수 없습니다.' };

  deleteRows_('결재선', readObjects_('결재선')
    .filter(function (l) { return l['문서번호'] === no; })
    .map(function (l) { return l._row; }));

  deleteRows_('결재내역', readObjects_('결재내역')
    .filter(function (i) { return i['문서번호'] === no; })
    .map(function (i) { return i._row; }));

  deleteRows_('첨부', readObjects_('첨부')
    .filter(function (f) { return f['대상ID'] === no; })
    .map(function (f) { return f._row; }));

  deleteRows_('문서상세', readObjects_('문서상세')
    .filter(function (d) { return d['문서번호'] === no; })
    .map(function (d) { return d._row; }));

  deleteRows_('결재문서', [doc._row]);

  var res = { ok: true, no: no, ms: took_() };
  log_(me.phone, '결재삭제', no, token);
  return res;
}

function api_notifications(token) {
  var u = requireUser_(token);
  var me = userInfo_(u);
  var rows = readObjects_('알림').filter(function (n) {
    return normPhone_(n['대상전화']) === me.phone && !n['읽음일시'];
  });
  return { ok: true, rows: rows.slice(-20).reverse().map(function (n) {
    return { id: n['알림ID'], kind: n['유형'], text: n['내용'], at: fmtDT_(n['생성일시']).substring(5) };
  }) };
}

/**
 * 알림 읽음 처리.
 * 예전에는 안 읽은 알림 줄마다 셀 하나씩 setValue 를 했다 (줄 수만큼 느려진다).
 * 지금은 이어진 구간으로 묶어서 한 번에 쓰고, 최근 400줄만 본다.
 */
function api_readNotifications(token) {
  var me = userInfo_(requireUser_(token));
  var sh = sheet_('알림');
  if (!sh) return { ok: true };

  var col = colIndex_('알림', '읽음일시');
  if (col < 0) return { ok: true };
  col += 1;

  var mine = tailObjects_('알림', 400).filter(function (n) {
    return normPhone_(n['대상전화']) === me.phone && !n['읽음일시'];
  }).map(function (n) { return n._row; }).sort(function (a, b) { return a - b; });
  if (!mine.length) return { ok: true, ms: took_() };

  var nowS = fmtDT_(now_());
  var i = 0;
  while (i < mine.length) {                   // 이어진 줄끼리 묶어서 한 번에
    var start = mine[i], end = start;
    while (i + 1 < mine.length && mine[i + 1] === end + 1) { end = mine[i + 1]; i++; }
    var block = [];
    for (var r = start; r <= end; r++) block.push([nowS]);
    sh.getRange(start, col, block.length, 1).setValues(block);
    i++;
  }
  dropObj_('알림');          // 캐시 번호표는 올라간다 (값이 낡지 않게)
  delete _VALS['알림'];
  /* ★ 바뀜 시각은 올리지 않는다 (v43).
     내 알림을 읽음 처리한 것 때문에 다른 5명이 board 를 통째로 다시 받을 이유가 없다. */
  return { ok: true, ms: took_() };
}

// =============================================================
//  설정 (관리자)
// =============================================================

function api_settings(token) {
  var u = requireUser_(token);
  var me = userInfo_(u);
  if (me.grade < 9) return { ok: false, msg: '관리자만 볼 수 있습니다.', me: me, ms: took_() };

  // 설정 값은 전부 문자열로 변환해서 보냄 (날짜 등이 섞이면 전송이 실패함)
  var _t = new Date().getTime();
  var raw = settings_();
  var st = {};
  for (var k in raw) {
    var v = raw[k];
    st[k] = (v instanceof Date) ? fmtDT_(v) : String(v == null ? '' : v);
  }
  add_('단계:설정값', _t);

  _t = new Date().getTime();
  var nameOf = nameMap_();
  var staff = readObjects_('직원').map(function (r) {
    var dp = normPhone_(r['대리인전화']);
    return {
      phone: normPhone_(r['전화번호']),
      name: String(r['이름'] || ''),
      dept: String(r['부서'] || ''),
      rank: String(r['직급'] || ''),
      grade: Number(r['권한등급'] || 1),
      state: String(r['재직상태'] || '재직'),
      hasPin: !!String(r['PIN해시'] || '').trim(),
      deputy: dp, deputyName: dp ? (nameOf[dp] || '') : ''
    };
  });
  add_('단계:직원목록', _t);

  // 지금 이 앱이 어느 스프레드시트를 보고 있는지 (프로젝트가 둘이라 헷갈린 적이 있다)
  _t = new Date().getTime();
  var ssInfo = { name: '', id: '', url: '' };
  try {
    var s = ss_();
    ssInfo = { name: String(s.getName()), id: String(s.getId()), url: String(s.getUrl()) };
  } catch (e) {}
  add_('단계:스프레드시트정보', _t);

  _t = new Date().getTime();
  var signs = signMap_();
  add_('단계:도장', _t);

  _t = new Date().getTime();
  var corps = meta_().corps;
  add_('단계:기준정보', _t);

  var res = { ok: true, settings: st, staff: staff, ss: ssInfo, me: me,
              signs: signs, corps: corps,
              big: bigSheets_(),        // 캐시에 못 담고 있는 시트 (v43)
              vers: areaVers_(),
              ms: took_() };
  res.t = timing_();
  logTiming_('api_settings');
  return res;
}

/**
 * 대리인 지정·해제 (관리자만).
 * phone 의 결재를 deputy 가 대신 처리할 수 있게 된다. deputy 가 비면 해제.
 */
function api_setDeputy(token, phone, deputy) {
  var me = userInfo_(requireUser_(token));
  if (me.grade < 9) return { ok: false, msg: '관리자만 지정할 수 있습니다.' };

  var target = findUserByPhone_(phone);
  if (!target) return { ok: false, msg: '직원을 찾을 수 없습니다.' };

  var dp = normPhone_(deputy);
  if (dp) {
    if (dp === normPhone_(target['전화번호'])) {
      return { ok: false, msg: '본인을 대리인으로 지정할 수 없습니다.' };
    }
    if (!findUserByPhone_(dp)) return { ok: false, msg: '대리인을 찾을 수 없습니다.' };
  }

  updateObject_('직원', target._row, { '대리인전화': dp });
  var res = { ok: true, ms: took_() };
  log_(me.phone, dp ? '대리인지정' : '대리인해제', normPhone_(phone), token);
  return res;
}

/**
 * 법인 도장 등록·교체 (관리자만).
 * 사람이 문서에 직접 찍지 않는다. 최종 승인되는 순간 시스템이 찍는다.
 */
function api_saveSign(token, corp, dataUrl) {
  var me = userInfo_(requireUser_(token));
  if (me.grade < 9) return { ok: false, msg: '관리자만 등록할 수 있습니다.' };
  if (!corp) return { ok: false, msg: '법인을 선택해주세요.' };
  if (!dataUrl) return { ok: false, msg: '도장을 그려주세요.' };

  ensureSignSheet_();
  var url = savePhoto_(dataUrl, 'seal_' + corp + '_' + stamp_());
  if (!url) return { ok: false, msg: '도장 이미지를 저장하지 못했습니다.' };

  var nowS = fmtDT_(now_());
  var target = null;
  readObjects_('서명').forEach(function (r) {
    if (String(r['구분'] || '') === '법인' && String(r['대상코드'] || '') === corp) target = r;
  });

  if (target) {
    updateObject_('서명', target._row, {
      '이미지': url, '등록자전화': me.phone, '등록일시': nowS
    });
  } else {
    appendObject_('서명', {
      '구분': '법인', '대상코드': corp, '이미지': url,
      '등록자전화': me.phone, '등록일시': nowS
    });
  }

  var res = { ok: true, url: url, signs: signMap_(), ms: took_() };
  log_(me.phone, '도장등록', corp, token);
  return res;
}

function api_saveSetting(token, key, val) {
  var u = requireUser_(token);
  var me = userInfo_(u);
  if (me.grade < 9) return { ok: false, msg: '관리자만 변경할 수 있습니다.' };
  setSetting_(key, val);
  bumpMeta_();
  log_(me.phone, '설정변경', key, token);
  return { ok: true };
}

/**
 * 기준정보 새로고침 (시트를 직접 고쳤을 때).
 * ★ 시트 번호표까지 전부 새로 만든다 (v39). 손으로 시트를 고친 뒤 이걸 누르면
 *   담아둔 값이 전부 버려지고 다음 요청이 시트에서 다시 읽는다.
 */
function api_refreshMeta(token) {
  requireUser_(token);
  bumpAllSheets_();
  bumpMeta_();
  var res = { ok: true, meta: meta_(), ms: took_() };
  res.t = timing_();
  logTiming_('api_refreshMeta');
  return res;
}

/**
 * 스프레드시트를 손으로 고쳤을 때 (설치형 onChange 트리거가 부른다).
 *
 * 앱이 저장해서 생긴 변경까지 여기서 전부 버리면 '바뀐 시트만 다시 읽기' 가 무의미해진다.
 * 그래서 **방금 앱이 쓴 직후면 그냥 넘어간다.** 앱은 쓸 때마다 touch_() 로 시각을 남긴다.
 */
function onSheetChange(e) {
  try {
    var last = Number(lastUpdate_() || 0);
    if (last && (new Date().getTime() - last) < 20000) return;   // 앱이 방금 쓴 것
    bumpAllSheets_();
    /* ★ 기준정보(meta)도 같이 버린다 (v46e).
       예전에는 시트 캐시만 버려서, 손으로 고친 '설정'·'법인'·'업무유형'·'문서양식' 이
       **6시간 동안 반영되지 않았습니다.** 회사명을 UNION-ONE 으로 고쳐놔도
       화면에는 계속 옛 이름이 떴습니다 (2026-08-28).
       사람이 시트를 손으로 고치는 것은 드문 일이라 다시 만드는 비용을 물어도 됩니다. */
    bumpMeta_();
    console.log('[캐시] 시트를 손으로 고친 것으로 보고 담아둔 값과 기준정보를 전부 버렸습니다.');
  } catch (err) {}
}

/** 지금 즉시 연동 동기화 */
function api_syncNow(token) {
  var me = userInfo_(requireUser_(token));
  if (me.grade < 9) return { ok: false, msg: '관리자만 실행할 수 있습니다.' };
  var a = syncAttendance_();
  var b = syncEstimates_();
  bumpMeta_();
  var res = {
    ok: true,
    att: a.ok ? (a.count + '명') : a.msg,
    est: b.ok ? (b.count + '건') : b.msg,
    ms: took_()
  };
  res.t = timing_();
  logTiming_('api_syncNow');
  return res;
}

function api_saveStaff(token, p) {
  var u = requireUser_(token);
  var me = userInfo_(u);
  if (me.grade < 9) return { ok: false, msg: '관리자만 변경할 수 있습니다.' };

  var phone = normPhone_(p.phone);
  var grade = Number(p.grade || 1);
  var state = String(p.state || '재직');
  if (!(grade >= 1 && grade <= 9)) return { ok: false, msg: '등급은 1에서 9 사이여야 합니다.' };
  if (['재직', '퇴사', '승인대기'].indexOf(state) < 0) state = '재직';

  var rows = readObjects_('직원');
  for (var i = 0; i < rows.length; i++) {
    if (normPhone_(rows[i]['전화번호']) === phone) {

      /* ★ 관리자가 한 명도 남지 않는 변경은 거부한다.
         실수로 본인 등급을 내리거나 퇴사 처리하면 아무도 되돌릴 수 없다.
         api_setGrade·api_setLeft 에는 있던 검사가 여기에는 없어서
         이 길로는 그대로 통과했다. */
      var was = Number(rows[i]['권한등급'] || 1);
      var wasState = String(rows[i]['재직상태'] || '재직');
      if (was >= 9 && wasState === '재직' && (grade < 9 || state !== '재직')) {
        var left = 0;
        rows.forEach(function (r) {
          if (normPhone_(r['전화번호']) === phone) return;
          if (String(r['재직상태'] || '재직') !== '재직') return;
          if (Number(r['권한등급'] || 1) >= 9) left += 1;
        });
        if (left < 1) {
          return { ok: false, msg: '관리자가 한 명도 남지 않게 됩니다. 다른 사람을 먼저 관리자로 올려주세요.' };
        }
      }

      updateObject_('직원', rows[i]._row, {
        '이름': p.name, '부서': p.dept || '', '직급': p.rank || '',
        '권한등급': grade, '재직상태': state
      });
      var res = { ok: true, ms: took_() };
      bumpMeta_();
      log_(me.phone, '직원수정', phone, token, p.name + ' 등급' + grade + ' ' + state);
      return res;
    }
  }

  appendObject_('직원', {
    '전화번호': phone, '이름': p.name, '부서': p.dept || '', '직급': p.rank || '',
    '권한등급': grade, '재직상태': '재직'
  });
  var res2 = { ok: true, ms: took_() };
  bumpMeta_();                       // 새 직원이 담당자 드롭다운에 바로 뜨게
  log_(me.phone, '직원추가', phone, token, p.name);
  return res2;
}
