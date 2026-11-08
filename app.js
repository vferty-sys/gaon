// 가온 공화국 — Firebase 무료(Spark) 기능만 사용: Authentication(이메일/비밀번호) + Cloud Firestore
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, signOut, reload
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, getDocs, runTransaction, serverTimestamp,
  collection, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ───── 나라 설정 (원하는 대로 바꾸세요. 구·직업을 바꾸면 firestore.rules의 목록도 같이 바꿔야 합니다) ───── */
const NATION = { name: "가온 공화국", en: "GAON REPUBLIC", code: "GA" };
const REGIONS = ["새벽구", "한울구", "다온구", "솔마루구"];
const JOBS = ["시민", "학자", "기술자", "상인", "예술가", "관리", "농부"];
const NAME_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ───── 시민번호: GA-발급일(KST)-순번+검증문자 ───── */
function kstYmd(date) {
  const k = new Date(date.getTime() + 9 * 3600 * 1000);
  return { y: k.getUTCFullYear(), m: String(k.getUTCMonth() + 1).padStart(2, "0"), d: String(k.getUTCDate()).padStart(2, "0") };
}
function numberOf(c) {
  const t = kstYmd(c.createdAt.toDate());
  const ymd = String(t.y).slice(2) + t.m + t.d;
  const body = String(c.seq).padStart(4, "0");
  const all = ymd + body;
  let sum = 0;
  for (let i = 0; i < all.length; i++) sum += Number(all[i]) * (i + 1);
  return `${NATION.code}-${ymd}-${body}${LETTERS[sum % LETTERS.length]}`;
}
function dateOf(c) { const t = kstYmd(c.createdAt.toDate()); return `${t.y}.${t.m}.${t.d}`; }

/* ───── 시민증 그리기 ───── */
function hash(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function avatar(name) {
  const h = hash(name), hue = h % 360, v = h % 3;
  const hair = `hsl(${hue} 30% 20%)`;
  const extra = v === 0 ? `<path d="M30 40q20-26 40 0z" fill="${hair}"/>`
    : v === 1 ? `<rect x="30" y="36" width="40" height="8" rx="3" fill="${hair}"/>`
    : `<path d="M28 52q-2-26 22-26t22 26q-8-14-22-14t-22 14z" fill="${hair}"/>`;
  return `<svg viewBox="0 0 100 125" aria-hidden="true"><rect width="100" height="125" fill="hsl(${hue} 38% 34%)"/>
    <circle cx="${18 + (h % 50)}" cy="${14 + (h % 30)}" r="${8 + (h % 9)}" fill="rgba(255,255,255,.14)"/>
    <path d="M12 125c2-30 18-42 38-42s36 12 38 42z" fill="hsl(${(hue + 180) % 360} 35% 60%)"/>
    <rect x="43" y="66" width="14" height="16" fill="hsl(${(hue + 30) % 360} 45% 78%)"/>
    <ellipse cx="50" cy="50" rx="19" ry="23" fill="hsl(${(hue + 30) % 360} 45% 78%)"/>${extra}</svg>`;
}
const EMBLEM = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="rgba(255,255,255,.12)"/>
  <circle cx="24" cy="24" r="18.5" fill="none" stroke="#e4bf6a" stroke-width="1.2"/><circle cx="24" cy="21" r="6" fill="#e4bf6a"/>
  <path d="M24 40V27M24 33c-4-.2-7-2.6-7.6-6.4 4 .2 7 2.4 7.6 6.4zM24 31c3.6-.2 6.4-2.4 7-6-3.6.2-6.4 2.2-7 6z" fill="none" stroke="#e4bf6a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function cardHtml(c, photo) {
  const num = numberOf(c);
  const mrz = (`ID<${NATION.code}<<${num.replace(/-/g, "")}<<<<<<<<<<<<<<<<<<`).slice(0, 34);
  const pic = photo && /^data:image\/jpeg;base64,/.test(photo) ? `<img alt="" src="${photo}">` : avatar(c.name);
  return `<div class="c-top">${EMBLEM}<div class="c-nation">${esc(NATION.name)}<small>${esc(NATION.en)}</small></div><div class="c-title">시민증</div></div>
    <div class="c-body"><div class="c-photo">${pic}</div><dl class="c-fields">
      <div class="wide"><dt>이름</dt><dd class="big">${esc(c.name)}</dd></div>
      <div class="wide"><dt>시민번호</dt><dd class="mono">${esc(num)}</dd></div>
      <div><dt>거주 구</dt><dd>${esc(c.region)}</dd></div>
      <div><dt>직업</dt><dd>${esc(c.job)}</dd></div>
      <div><dt>발급일</dt><dd>${esc(dateOf(c))}</dd></div>
      <div><dt>유효기간</dt><dd>영구</dd></div></dl></div>
    <div class="c-mrz">${esc(mrz)}</div>`;
}

/* ───── 화면 전환 ───── */
const VIEWS = ["v-out", "v-verify", "v-apply", "v-card"];
function show(id, sub) {
  VIEWS.forEach((v) => { $(v).hidden = v !== id; });
  if (sub) $("me-sub").textContent = sub;
}
function say(text, kind) {
  const m = $("me-msg");
  m.textContent = text || "";
  m.className = "msg" + (kind ? " " + kind : "");
}
async function busy(btn, fn) {
  btn.disabled = true;
  try { await fn(); } finally { btn.disabled = false; }
}

const AUTH_ERR = {
  "auth/email-already-in-use": "이미 가입된 이메일입니다. 로그인해 주세요.",
  "auth/invalid-email": "이메일 형식이 맞지 않습니다.",
  "auth/weak-password": "비밀번호가 너무 짧습니다. 8자 이상으로 정해 주세요.",
  "auth/invalid-credential": "이메일 또는 비밀번호가 맞지 않습니다.",
  "auth/wrong-password": "이메일 또는 비밀번호가 맞지 않습니다.",
  "auth/user-not-found": "이메일 또는 비밀번호가 맞지 않습니다.",
  "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 해 주세요.",
  "auth/network-request-failed": "인터넷 연결을 확인해 주세요.",
  "auth/missing-password": "비밀번호를 입력해 주세요."
};
const errText = (e) => AUTH_ERR[e && e.code] || "처리하지 못했습니다. 잠시 후 다시 해 주세요.";

/* ───── 시작 ───── */
$("ap-region").innerHTML = REGIONS.map((r) => `<option>${esc(r)}</option>`).join("");
$("ap-job").innerHTML = JOBS.map((r) => `<option>${esc(r)}</option>`).join("");

$("tab-login").addEventListener("click", () => tab(true));
$("tab-signup").addEventListener("click", () => tab(false));
function tab(login) {
  $("tab-login").setAttribute("aria-selected", String(login));
  $("tab-signup").setAttribute("aria-selected", String(!login));
  $("f-login").hidden = !login;
  $("f-signup").hidden = login;
  say("");
}

const configured = firebaseConfig && firebaseConfig.apiKey && !/여기에/.test(firebaseConfig.apiKey);
if (!configured) {
  $("setup-warning").hidden = false;
  $("none").textContent = "Firebase 설정을 마치면 명부가 나타납니다.";
  document.querySelectorAll("form").forEach((f) => f.addEventListener("submit", (e) => {
    e.preventDefault();
    say("firebase-config.js 설정을 먼저 마쳐 주세요.", "err");
  }));
} else {
  start();
}

function start() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  auth.languageCode = "ko";
  const db = getFirestore(app);
  let myCitizen = null;

  /* 로그인 상태에 따라 화면 결정 */
  onAuthStateChanged(auth, (user) => route(user));
  async function route(user) {
    if (!user) { myCitizen = null; show("v-out", "로그인하면 내 시민증을 볼 수 있습니다."); return; }
    if (!user.emailVerified) {
      $("vf-email").textContent = user.email;
      show("v-verify", "이메일 인증을 마쳐야 시민증을 받을 수 있습니다.");
      return;
    }
    try {
      const snap = await getDoc(doc(db, "citizens", user.uid));
      if (snap.exists()) {
        myCitizen = snap.data();
        const ph = await getDoc(doc(db, "photos", user.uid));
        $("my-card").innerHTML = cardHtml(myCitizen, ph.exists() ? ph.data().data : "");
        show("v-card", `${myCitizen.name} 님의 시민증입니다.`);
      } else {
        await user.getIdToken(true); // 인증 완료 상태를 서버 규칙에 바로 반영
        show("v-apply", "시민권 신청서를 작성해 주세요.");
      }
    } catch (e) {
      say("정보를 불러오지 못했습니다. 새로고침해 주세요.", "err");
    }
  }

  /* 로그인 */
  $("f-login").addEventListener("submit", (e) => {
    e.preventDefault();
    const btn = e.submitter || $("f-login").querySelector("button[type=submit]");
    busy(btn, async () => {
      try {
        await signInWithEmailAndPassword(auth, $("li-email").value.trim(), $("li-pw").value);
        say("");
      } catch (err) { say(errText(err), "err"); }
    });
  });

  /* 비밀번호 재설정 */
  $("btn-reset").addEventListener("click", async () => {
    const email = $("li-email").value.trim();
    if (!email) { say("위 칸에 이메일을 먼저 적어 주세요.", "err"); $("li-email").focus(); return; }
    try {
      await sendPasswordResetEmail(auth, email);
      say("비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.", "ok");
    } catch (err) { say(errText(err), "err"); }
  });

  /* 가입 */
  $("f-signup").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("su-email").value.trim(), pw = $("su-pw").value;
    if (pw.length < 8) { say("비밀번호는 8자 이상이어야 합니다.", "err"); return; }
    if (pw !== $("su-pw2").value) { say("비밀번호 확인이 일치하지 않습니다.", "err"); return; }
    const btn = e.submitter || $("f-signup").querySelector("button[type=submit]");
    busy(btn, async () => {
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, pw);
        await sendEmailVerification(cred.user);
        say("인증 메일을 보냈습니다.", "ok");
        route(cred.user);
      } catch (err) { say(errText(err), "err"); }
    });
  });

  /* 인증 확인 */
  $("btn-verified").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    const user = auth.currentUser;
    if (!user) return;
    await reload(user);
    if (!user.emailVerified) { say("아직 인증이 확인되지 않았습니다. 메일의 링크를 눌렀는지 확인해 주세요.", "err"); return; }
    await user.getIdToken(true);
    say("인증이 확인되었습니다.", "ok");
    route(user);
  }));
  $("btn-resend").addEventListener("click", (e) => busy(e.currentTarget, async () => {
    try {
      await sendEmailVerification(auth.currentUser);
      say("인증 메일을 다시 보냈습니다.", "ok");
    } catch (err) { say(errText(err), "err"); }
  }));

  document.querySelectorAll("[data-logout]").forEach((b) => b.addEventListener("click", async () => {
    await signOut(auth);
    say("로그아웃했습니다.");
  }));

  /* 사진 줄이기 (Storage는 유료 플랜이 필요해서 사진을 작게 줄여 Firestore에 문자열로 저장) */
  let photoData = "";
  $("ap-photo").addEventListener("change", function () {
    photoData = "";
    const f = this.files && this.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const w = 160, h = 200, cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        const s = Math.max(w / img.width, h / img.height);
        cv.getContext("2d").drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
        let q = 0.8, out = cv.toDataURL("image/jpeg", q);
        while (out.length > 55000 && q > 0.3) { q -= 0.1; out = cv.toDataURL("image/jpeg", q); }
        photoData = out.length < 60000 ? out : "";
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  });

  /* 시민증 발급: 카운터 +1, 이름 예약, 시민증 생성을 한 번에 처리 */
  $("f-apply").addEventListener("submit", (e) => {
    e.preventDefault();
    const user = auth.currentUser;
    const name = $("ap-name").value.trim();
    if (!NAME_RE.test(name)) { say("이름은 한글·영문·숫자·_ 로 2~12자여야 합니다. 띄어쓰기는 쓸 수 없습니다.", "err"); $("ap-name").focus(); return; }
    if (!$("ap-agree").checked) { say("헌법 확인에 동의해야 시민증이 발급됩니다.", "err"); return; }
    const key = name.toLowerCase();
    const data = { name, nameKey: key, region: $("ap-region").value, job: $("ap-job").value, reason: $("ap-reason").value.trim().slice(0, 80) };
    busy($("btn-apply"), async () => {
      try {
        await runTransaction(db, async (tx) => {
          const cRef = doc(db, "meta", "counter"), nRef = doc(db, "names", key), meRef = doc(db, "citizens", user.uid);
          const [c, n, me] = [await tx.get(cRef), await tx.get(nRef), await tx.get(meRef)];
          if (me.exists()) throw { code: "already" };
          if (n.exists()) throw { code: "name-taken" };
          const seq = c.exists() ? c.data().n + 1 : 1;
          if (c.exists()) tx.update(cRef, { n: seq }); else tx.set(cRef, { n: 1 });
          tx.set(nRef, { uid: user.uid });
          tx.set(meRef, { ...data, seq, createdAt: serverTimestamp() });
          if (photoData) tx.set(doc(db, "photos", user.uid), { data: photoData });
        });
        say(`${name} 님, 가온 공화국 시민이 되신 것을 환영합니다.`, "ok");
        await route(user);
        loadRegistry();
      } catch (err) {
        if (err.code === "name-taken") say("이미 사용 중인 이름입니다. 다른 이름을 적어 주세요.", "err");
        else if (err.code === "already") { say("이미 시민증이 있습니다."); route(user); }
        else if (err.code === "permission-denied") say("발급이 거절되었습니다. 이메일 인증을 마쳤는지, 이름이 이미 쓰이고 있지 않은지 확인해 주세요.", "err");
        else say("발급하지 못했습니다. 잠시 후 다시 해 주세요.", "err");
      }
    });
  });

  /* 시민번호 복사 */
  $("btn-copy").addEventListener("click", () => {
    if (!myCitizen) return;
    const num = numberOf(myCitizen);
    const msg = $("copy-msg");
    const fallback = () => {
      const node = $("my-card").querySelector("dd.mono");
      const r = document.createRange(); r.selectNodeContents(node);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      msg.textContent = "선택했습니다. 길게 눌러 복사하세요.";
    };
    if (navigator.clipboard) navigator.clipboard.writeText(num).then(() => { msg.textContent = "복사했습니다."; }, fallback);
    else fallback();
  });

  /* 진위 확인 */
  $("f-verify").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("vr-result");
    const raw = $("vr-num").value.trim().toUpperCase().replace(/\s/g, "");
    const m = raw.match(/^([A-Z]{2})-?(\d{6})-?(\d{4,})([A-Z])$/);
    const fail = (t) => { out.innerHTML = `<span class="stamp no">등록되지 않은 시민번호</span><p class="note">${esc(t)}</p>`; };
    if (!m || m[1] !== NATION.code) { fail("번호 형식을 확인해 주세요. 예: GA-261108-0001A"); return; }
    out.innerHTML = `<p class="note">조회 중입니다.</p>`;
    try {
      const snap = await getDocs(query(collection(db, "citizens"), where("seq", "==", Number(m[3])), limit(1)));
      if (snap.empty) { fail("명부에 없는 번호입니다."); return; }
      const d = snap.docs[0], c = d.data();
      if (numberOf(c) !== `${m[1]}-${m[2]}-${m[3]}${m[4]}`) { fail("순번은 있지만 발급일이나 검증문자가 다릅니다. 위조되었을 수 있습니다."); return; }
      const ph = await getDoc(doc(db, "photos", d.id));
      out.innerHTML = `<span class="stamp ok">정식 발급된 시민증입니다</span><div class="card-wrap"><div class="card">${cardHtml(c, ph.exists() ? ph.data().data : "")}</div></div>
        <p class="note">채팅방에 올라온 시민증 사진과 이름·번호·사진이 같은지 비교하세요.</p>`;
    } catch (err) { fail("조회하지 못했습니다. 잠시 후 다시 해 주세요."); }
  });

  /* 국민 명부 */
  let people = [];
  async function loadRegistry() {
    try {
      const [snap, counter] = await Promise.all([
        getDocs(query(collection(db, "citizens"), orderBy("seq", "desc"), limit(100))),
        getDoc(doc(db, "meta", "counter"))
      ]);
      people = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.createdAt);
      $("pop").textContent = counter.exists() ? counter.data().n : 0;
      renderRows();
    } catch (e) {
      $("none").hidden = false;
      $("none").textContent = "명부를 불러오지 못했습니다. 새로고침해 주세요.";
    }
  }
  function renderRows() {
    const q = $("q").value.trim().toLowerCase();
    const list = people.filter((c) => !q || c.name.toLowerCase().includes(q) || numberOf(c).toLowerCase().includes(q));
    $("rows").innerHTML = list.map((c) => `<tr><td class="num">${esc(numberOf(c))}</td><td>${esc(c.name)}</td><td>${esc(c.region)}</td><td>${esc(c.job)}</td><td>${esc(dateOf(c))}</td><td><button type="button" data-num="${esc(numberOf(c))}">진위 확인</button></td></tr>`).join("");
    $("none").hidden = list.length > 0;
    $("none").textContent = people.length ? "찾는 시민이 없습니다." : "아직 시민이 없습니다. 첫 번째 시민이 되어 보세요.";
  }
  $("q").addEventListener("input", renderRows);
  $("btn-refresh").addEventListener("click", loadRegistry);
  $("rows").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-num]");
    if (!b) return;
    $("vr-num").value = b.dataset.num;
    $("f-verify").requestSubmit();
    $("verify").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  loadRegistry();
}
