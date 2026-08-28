/**
 * =============================================================
 *  UNION ONE — 사용 신청과 승인
 *  파일명: 가입승인.js
 * -------------------------------------------------------------
 *  직원이 앱에서 직접 신청하고, 관리자가 앱에서 승인합니다.
 *
 *  지켜야 할 선
 *   · 신청으로 만들어지는 계정은 언제나 등급 1 입니다.
 *     앱을 통해서는 어떤 경로로도 등급 9 가 되지 않습니다.
 *   · 승인 전에는 PIN 이 맞아도 로그인되지 않습니다.
 *   · 화면에서 버튼을 숨기는 것만으로는 막지 않습니다.
 *     승인·거절·등급변경은 서버가 보낸 사람의 등급을 시트에서 다시 확인합니다.
 * =============================================================
 */

var 신청기본등급 = 1;
var 관리자등급 = 9;


/* =============================================================
 *  직원용 — 사용 신청
 *  로그인 전에도 부를 수 있는 유일한 쓰기 기능입니다.
 * ============================================================= */
function api_signup(phone, name, pin) {
  ensureColumn_('직원', 'PIN해시');

  var 번호 = normPhone_(phone);
  var 이름 = String(name || '').trim();
  var 핀 = String(pin || '').replace(/[^0-9]/g, '');

  if (번호.replace(/[^0-9]/g, '').length < 10) {
    return { ok: false, msg: '번호를 정확히 입력해주세요.' };
  }
  if (이름.length < 2 || 이름.length > 20) {
    return { ok: false, msg: '이름을 정확히 입력해주세요.' };
  }
  if (핀.length !== 4) {
    return { ok: false, msg: 'PIN 4자리를 입력해주세요.' };
  }
  if (/^(\d)\1{3}$/.test(핀) || 핀 === '1234' || 핀 === '0000') {
    return { ok: false, msg: '너무 쉬운 번호입니다. 다른 번호로 정해주세요.' };
  }

  /* 한 번에 한 사람만 들어오게 한다 (같은 순간에 두 명이 신청해도 안전하게) */
  var lock = null;
  try { lock = LockService.getScriptLock(); } catch (e) { lock = null; }
  if (lock) {
    var 잡음 = false;
    try { 잡음 = lock.tryLock(10000); } catch (e2) { 잡음 = false; }
    if (!잡음) return { ok: false, msg: '잠시 후 다시 시도해주세요.' };
  }

  try {
    _VALS = {}; _HEAD = {}; _OBJ = {};

    var 있음 = findUserByPhone_(번호);
    if (있음) {
      var st = String(있음['재직상태'] || '재직');
      if (st === '승인대기') {
        return { ok: false, msg: '이미 신청하셨습니다. 관리자 승인을 기다려주세요.' };
      }
      return { ok: false, msg: '이미 등록된 번호입니다. 로그인해주세요.' };
    }

    appendObject_('직원', {
      '전화번호': 번호,
      '이름': 이름,
      '부서': '',
      '직급': '',
      '권한등급': 신청기본등급,          // 신청은 언제나 등급 1
      '재직상태': '승인대기',
      'PIN해시': hashPin_(번호, 핀),
      '대리인전화': '',
      '기기토큰': '',
      '최근접속일시': ''
    });

    try { log_(번호, '사용신청', '', '', 이름); } catch (e) {}
    try { 관리자에게알림_(이름, 번호); } catch (e) {}
    try { bumpMeta_(); } catch (e) {}

    return { ok: true, msg: '신청이 접수되었습니다. 관리자 승인 후 이용할 수 있습니다.' };

  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e3) {} }
  }
}


/* =============================================================
 *  관리자용 — 승인 / 거절 / 등급변경
 * ============================================================= */

/** 승인 — 승인대기를 재직으로 바꿉니다 */
function api_approve(token, phone) {
  var 나 = 관리자확인_(token);
  if (!나.ok) return 나;

  var 대상 = 찾은줄_(phone);
  if (!대상) return { ok: false, msg: '대상을 찾지 못했습니다.' };

  if (String(대상['재직상태'] || '') !== '승인대기') {
    return { ok: false, msg: '승인 대기 상태가 아닙니다.' };
  }

  updateObject_('직원', 대상._row, { '재직상태': '재직' });
  try { log_(나.phone, '승인', normPhone_(phone), token, 대상['이름']); } catch (e) {}
  try { notify_(normPhone_(phone), '승인', '', '사용 신청이 승인되었습니다. 지금부터 이용하실 수 있습니다.'); } catch (e) {}
  try { bumpMeta_(); } catch (e) {}

  return { ok: true, msg: 대상['이름'] + '님을 승인했습니다.' };
}


/** 거절 — 줄을 지웁니다. 승인대기 상태만 지울 수 있습니다 */
function api_reject(token, phone) {
  var 나 = 관리자확인_(token);
  if (!나.ok) return 나;

  var 대상 = 찾은줄_(phone);
  if (!대상) return { ok: false, msg: '대상을 찾지 못했습니다.' };

  /* 이미 쓰고 있는 직원을 실수로 지우지 않도록 승인대기만 허용한다 */
  if (String(대상['재직상태'] || '') !== '승인대기') {
    return { ok: false, msg: '승인 대기 상태만 거절할 수 있습니다.' };
  }

  var 이름 = 대상['이름'];
  deleteRow_('직원', 대상._row);
  try { log_(나.phone, '거절', normPhone_(phone), token, 이름); } catch (e) {}
  try { bumpMeta_(); } catch (e) {}
  try { _VALS = {}; _HEAD = {}; _OBJ = {}; } catch (e) {}

  return { ok: true, msg: 이름 + '님의 신청을 거절했습니다.' };
}


/** 등급 변경 — 관리자가 앱에서 등급을 올리고 내립니다 */
function api_setGrade(token, phone, grade) {
  var 나 = 관리자확인_(token);
  if (!나.ok) return 나;

  var 새등급 = Number(grade || 1);
  if (!(새등급 >= 1 && 새등급 <= 9)) {
    return { ok: false, msg: '등급은 1에서 9 사이여야 합니다.' };
  }

  var 대상 = 찾은줄_(phone);
  if (!대상) return { ok: false, msg: '대상을 찾지 못했습니다.' };

  /* 관리자를 0명으로 만드는 변경은 막는다.
     실수로 본인 등급을 내리면 아무도 되돌릴 수 없다. */
  var 지금등급 = Number(대상['권한등급'] || 1);
  if (지금등급 >= 관리자등급 && 새등급 < 관리자등급) {
    var 남는관리자 = 0;
    readObjects_('직원').forEach(function (r) {
      if (normPhone_(r['전화번호']) === normPhone_(phone)) return;
      if (String(r['재직상태'] || '재직') !== '재직') return;
      if (Number(r['권한등급'] || 1) >= 관리자등급) 남는관리자 += 1;
    });
    if (남는관리자 < 1) {
      return { ok: false, msg: '관리자가 한 명도 남지 않게 됩니다. 다른 사람을 먼저 관리자로 올려주세요.' };
    }
  }

  updateObject_('직원', 대상._row, { '권한등급': 새등급 });
  try { log_(나.phone, '등급변경', normPhone_(phone), token, 지금등급 + '→' + 새등급); } catch (e) {}
  try { bumpMeta_(); } catch (e) {}

  return { ok: true, msg: 대상['이름'] + '님을 등급 ' + 새등급 + '로 바꿨습니다.' };
}


/** 퇴사 처리 — 지우지 않고 상태만 바꿉니다. 남긴 기록은 그대로 둡니다 */
function api_setLeft(token, phone, leave) {
  var 나 = 관리자확인_(token);
  if (!나.ok) return 나;

  var 대상 = 찾은줄_(phone);
  if (!대상) return { ok: false, msg: '대상을 찾지 못했습니다.' };

  var 퇴사로 = !!leave;

  if (퇴사로 && Number(대상['권한등급'] || 1) >= 관리자등급) {
    var 남는관리자 = 0;
    readObjects_('직원').forEach(function (r) {
      if (normPhone_(r['전화번호']) === normPhone_(phone)) return;
      if (String(r['재직상태'] || '재직') !== '재직') return;
      if (Number(r['권한등급'] || 1) >= 관리자등급) 남는관리자 += 1;
    });
    if (남는관리자 < 1) {
      return { ok: false, msg: '마지막 관리자는 퇴사 처리할 수 없습니다.' };
    }
  }

  updateObject_('직원', 대상._row, {
    '재직상태': 퇴사로 ? '퇴사' : '재직',
    '기기토큰': 퇴사로 ? '' : String(대상['기기토큰'] || '')
  });

  try { log_(나.phone, 퇴사로 ? '퇴사처리' : '복직처리', normPhone_(phone), token, 대상['이름']); } catch (e) {}
  try { bumpMeta_(); } catch (e) {}

  return { ok: true, msg: 대상['이름'] + '님을 ' + (퇴사로 ? '퇴사' : '재직') + ' 처리했습니다.' };
}


/* =============================================================
 *  도우미
 * ============================================================= */

/** 보낸 사람이 정말 관리자인지 시트에서 다시 확인한다 */
function 관리자확인_(token) {
  var u = findUserByToken_(token);
  if (!u) return { ok: false, code: 'NOAUTH', msg: '다시 로그인해주세요.' };

  if (String(u['재직상태'] || '재직') !== '재직') {
    return { ok: false, msg: '사용할 수 없는 계정입니다.' };
  }
  if (Number(u['권한등급'] || 1) < 관리자등급) {
    return { ok: false, msg: '관리자만 할 수 있습니다.' };
  }
  return { ok: true, phone: normPhone_(u['전화번호']), name: u['이름'] };
}

/** 전화번호로 직원 줄을 찾는다 */
function 찾은줄_(phone) {
  var 번호 = normPhone_(phone);
  var rows = readObjects_('직원');
  for (var i = 0; i < rows.length; i++) {
    if (normPhone_(rows[i]['전화번호']) === 번호) return rows[i];
  }
  return null;
}

/** 관리자 전원에게 신청 알림을 남긴다 */
function 관리자에게알림_(이름, 번호) {
  readObjects_('직원').forEach(function (r) {
    if (Number(r['권한등급'] || 1) < 관리자등급) return;
    if (String(r['재직상태'] || '재직') !== '재직') return;
    try {
      notify_(normPhone_(r['전화번호']), '가입신청', normPhone_(번호),
              이름 + '님이 사용 신청을 했습니다. 설정 화면에서 승인해주세요.');
    } catch (e) {}
  });
}
