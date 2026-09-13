// ===================================================
// 우리 반 담벼락 - Firestore + 구글 로그인 + 역할 구분 버전
//
// 메모를 쓰면 Firestore에 저장되고,
// 올린 순서(createdAt)대로 담벼락에 붙습니다.
// 구글 로그인을 해야 메모를 쓸 수 있습니다.
// 로그인한 사람은 "student"(학생) 또는 "teacher"(교사)이고,
// 학생은 메모를 쓰기만 할 수 있고, 교사만 아무 메모나 지울 수 있습니다.
// (진짜 보안은 firestore.rules 파일이 담당합니다)
// 교사는 메모마다 AI 버튼을 눌러 Gemini가 만든 코멘트를 달 수 있습니다.
// 왼쪽 가장자리에 마우스를 올리면 날짜별 목록이 나오고, 날짜를 고르면
// 그날 쓴 메모만 담벼락에 보여줍니다.
// ===================================================


// --- Firebase SDK 가져오기 (CDN ES Module, v9 modular 방식) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDoc,
  setDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";


// --- Firebase 설정 ---
const firebaseConfig = {
  apiKey: "AIzaSyB-eLavzX0rIOVcKiGh1Ww5ry3rHzbY3YE",
  authDomain: "class-wall-starter-bae.firebaseapp.com",
  projectId: "class-wall-starter-bae",
  storageBucket: "class-wall-starter-bae.firebasestorage.app",
  messagingSenderId: "99793555090",
  appId: "1:99793555090:web:7448635d0061cfdf2a604b"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// Firestore 컬렉션 참조 ("memos" 컬렉션을 사용합니다)
const memosCol = collection(db, "memos");


// --- 메모 목록 (Firestore에서 실시간으로 받아옵니다) ---
let memos = [];

// --- 로그인한 사람의 역할 ("teacher" 또는 "student") ---
// 처음 로그인하면 자동으로 "student"가 되고,
// 교사는 Firebase 콘솔에서 본인의 users 문서를 "teacher"로 직접 바꿔야 합니다.
let currentRole = null;
let unsubscribeRole = null;

// --- 왼쪽 사이드에서 고른 날짜 (null이면 전체 보기) ---
let selectedDate = null;


// ===================================================
// 데이터를 다루는 함수 세 개
// Firestore를 사용하도록 바뀌었습니다.
// ===================================================

// 메모를 읽어 옵니다.
// Firestore의 실시간 리스너(onSnapshot)가 memos 배열을 자동으로 갱신하므로,
// 이 함수는 현재 메모 배열을 createdAt 순으로 정렬하여 반환합니다.
// 왼쪽 사이드에서 날짜를 골랐으면(selectedDate), 그 날짜의 메모만 걸러냅니다.
function loadMemos() {
  const sorted = memos.slice().sort(function (a, b) {
    // createdAt이 아직 서버에서 안 내려온 경우(null) 맨 뒤로 보냅니다
    const timeA = a.createdAt || Infinity;
    const timeB = b.createdAt || Infinity;
    return timeA - timeB;
  });

  if (!selectedDate) return sorted;

  return sorted.filter(function (memo) {
    return memo.createdAt && dateKey(memo.createdAt) === selectedDate;
  });
}

// 밀리초 시각을 "2026-09-13" 같은 날짜 키로 바꿉니다. (사이드바에서 날짜를 구분하는 용도)
function dateKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// 날짜 키를 "9월 13일 (일)" 같이 사람이 읽기 좋은 글자로 바꿉니다.
function formatDateLabel(key) {
  const parts = key.split("-").map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

// 메모를 새로 씁니다.
// Firestore에 문서를 추가합니다. 저장이 끝나면 onSnapshot이 자동으로 화면을 갱신합니다.
// ownerUid를 함께 저장해서, 이 메모가 누구 것인지 표시합니다.
// (다른 사람의 uid로 몰래 쓰는 것은 Firestore 보안 규칙이 막습니다)
async function addMemo(text) {
  await addDoc(memosCol, {
    text: text,
    ownerUid: auth.currentUser.uid,
    createdAt: serverTimestamp()  // 서버 시각을 사용합니다
  });
}

// 메모를 지웁니다.
// Firestore에서 해당 문서를 삭제합니다. 삭제가 끝나면 onSnapshot이 자동으로 화면을 갱신합니다.
async function deleteMemo(id) {
  await deleteDoc(doc(db, "memos", id));
}

// 메모 내용을 Vercel 서버(/api/gemini)로 보내서 AI 코멘트를 받아 옵니다.
// (Gemini API 키는 서버에만 있고, 여기서는 그 결과만 받습니다)
async function requestAiComment(text) {
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "AI 코멘트 요청에 실패했습니다.");
  }
  return data.comment;
}

// 메모에 AI 코멘트를 받아서 Firestore에 저장합니다.
// (memos 문서 수정은 교사만 할 수 있도록 Firestore 규칙에서 막혀 있습니다)
async function addAiComment(id, text) {
  const comment = await requestAiComment(text);
  await updateDoc(doc(db, "memos", id), { aiComment: comment });
}


// ===================================================
// 화면 그리기
// ===================================================

function render() {
  const wall = document.getElementById("wall");
  wall.innerHTML = "";

  loadMemos().forEach(function (memo) {
    wall.appendChild(makeMemo(memo));
  });
}

// 왼쪽 사이드바의 날짜 목록을 그립니다. ("전체 보기" + 메모가 있는 날짜들)
function renderDateList() {
  const dateList = document.getElementById("dateList");
  dateList.innerHTML = "";

  const keys = memos
    .filter(function (memo) { return memo.createdAt; })
    .map(function (memo) { return dateKey(memo.createdAt); });
  const uniqueKeys = Array.from(new Set(keys)).sort().reverse();

  const allItem = document.createElement("li");
  allItem.textContent = "전체 보기";
  allItem.className = selectedDate === null ? "active" : "";
  allItem.addEventListener("click", function () {
    selectedDate = null;
    renderDateList();
    render();
  });
  dateList.appendChild(allItem);

  uniqueKeys.forEach(function (key) {
    const item = document.createElement("li");
    item.textContent = formatDateLabel(key);
    item.className = key === selectedDate ? "active" : "";
    item.addEventListener("click", function () {
      selectedDate = key;
      renderDateList();
      render();
    });
    dateList.appendChild(item);
  });
}

// 메모 한 장 만들기
function makeMemo(memo) {
  const div = document.createElement("div");
  div.className = "memo";

  // 삭제(빨강)·AI(노랑) 버튼은 교사한테만, 맥의 신호등 버튼처럼 왼쪽 위에 동그랗게 보여줍니다.
  // (학생은 자기 메모라도 지울 수 없습니다 - 규칙에서도 막혀 있습니다)
  if (currentRole === "teacher") {
    const dots = document.createElement("div");
    dots.className = "memo-dots";

    const del = document.createElement("button");
    del.className = "dot dot-close";
    del.textContent = "×";
    del.title = "메모 지우기";
    // addEventListener 방식으로 이벤트를 등록합니다
    del.addEventListener("click", async function () {
      await deleteMemo(memo.id);
      // onSnapshot이 render()를 자동 호출하므로 여기서는 따로 부르지 않습니다
    });
    dots.appendChild(del);

    const aiBtn = document.createElement("button");
    aiBtn.className = "dot dot-ai";
    aiBtn.textContent = "AI";
    aiBtn.title = "이 메모에 AI 코멘트 달기";
    aiBtn.addEventListener("click", async function () {
      aiBtn.disabled = true;
      try {
        await addAiComment(memo.id, memo.text);
        // onSnapshot이 render()를 자동 호출하므로 여기서는 따로 부르지 않습니다
      } catch (error) {
        console.error("AI 코멘트 실패:", error);
        alert("AI 코멘트를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
        aiBtn.disabled = false;
      }
    });
    dots.appendChild(aiBtn);

    div.appendChild(dots);
  }

  const span = document.createElement("span");
  span.textContent = memo.text;
  div.appendChild(span);

  // AI 코멘트가 있으면 메모 아래에 함께 보여줍니다.
  if (memo.aiComment) {
    const aiComment = document.createElement("p");
    aiComment.className = "ai-comment";
    aiComment.textContent = "🤖 " + memo.aiComment;
    div.appendChild(aiComment);
  }

  return div;
}


// ===================================================
// 메모 쓰는 칸
// 엔터를 누르면 담벼락에 붙습니다 (줄바꿈은 Shift + 엔터)
// ===================================================

const input = document.getElementById("input");

// addEventListener 방식으로 이벤트를 등록합니다
input.addEventListener("keydown", async function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();

    const text = input.value.trim();
    if (text === "") return;

    // 5글자 이상일 때만 저장합니다
    if (text.length < 5) {
      alert("메모는 5글자 이상 입력해 주세요.");
      return;
    }

    await addMemo(text);
    input.value = "";
    // onSnapshot이 render()를 자동 호출하므로 여기서는 따로 부르지 않습니다
  }
});


// ===================================================
// Firestore 실시간 리스너
// 데이터가 바뀔 때마다 자동으로 memos를 갱신하고 화면을 다시 그립니다.
// ===================================================

const memosQuery = query(memosCol, orderBy("createdAt"));

onSnapshot(memosQuery, function (snapshot) {
  memos = snapshot.docs.map(function (docSnap) {
    const data = docSnap.data();
    return {
      id: docSnap.id,                                    // Firestore 문서 ID
      text: data.text,
      aiComment: data.aiComment || null,                  // 교사가 요청한 AI 코멘트
      createdAt: data.createdAt ? data.createdAt.toMillis() : null  // Timestamp → 밀리초
    };
  });
  renderDateList();
  render();
});


// ===================================================
// 구글 로그인 / 로그아웃
// ===================================================

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");
const userNameSpan = document.getElementById("userName");
const userUidSpan = document.getElementById("userUid");
const writer = document.getElementById("writer");

// 로그인 버튼 클릭 시 구글 팝업 로그인
loginBtn.addEventListener("click", async function () {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("로그인 실패:", error);
    alert("로그인에 실패했습니다. 다시 시도해 주세요.");
  }
});

// 로그아웃 버튼 클릭
logoutBtn.addEventListener("click", async function () {
  await signOut(auth);
});

// users/{uid} 문서를 확인해서, 처음 로그인하는 사람이면 "student"로 만들어 줍니다.
// 이미 있으면 손대지 않습니다 (교사로 바꿔둔 걸 덮어쓰지 않기 위해서입니다).
async function ensureUserDoc(uid) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, { role: "student" });
  }
}

// users/{uid} 문서를 실시간으로 지켜보다가, role이 바뀌면 화면도 다시 그립니다.
// (교사가 콘솔에서 역할을 바꿔주면, 다시 로그인하지 않아도 반영됩니다)
function watchRole(uid) {
  const userRef = doc(db, "users", uid);
  unsubscribeRole = onSnapshot(userRef, function (snap) {
    currentRole = snap.exists() ? snap.data().role : "student";
    render();
  });
}

// 로그인 상태가 바뀔 때마다 화면을 갱신합니다
onAuthStateChanged(auth, async function (user) {
  if (user) {
    // 로그인 상태: 이름을 보여주고, 입력 칸을 엽니다
    loginBtn.style.display = "none";
    userInfo.style.display = "inline";
    userNameSpan.textContent = "🙂 " + user.displayName + "님";
    // 교사로 바꾸려면 이 uid로 Firebase 콘솔의 users 문서를 고쳐야 합니다.
    userUidSpan.textContent = "(uid: " + user.uid + ")";
    writer.hidden = false;
    input.focus();

    await ensureUserDoc(user.uid);
    watchRole(user.uid);
  } else {
    // 로그아웃 상태: 로그인 버튼만 보여줍니다
    loginBtn.style.display = "inline";
    userInfo.style.display = "none";
    userNameSpan.textContent = "";
    userUidSpan.textContent = "";
    writer.hidden = true;

    if (unsubscribeRole) {
      unsubscribeRole();
      unsubscribeRole = null;
    }
    currentRole = null;
    render();
  }
});
