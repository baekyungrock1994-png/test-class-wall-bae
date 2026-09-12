// ===================================================
// 우리 반 담벼락 - Firestore + 구글 로그인 버전
//
// 메모를 쓰면 Firestore에 저장되고,
// 올린 순서(createdAt)대로 담벼락에 붙습니다.
// 구글 로그인을 해야 메모를 쓸 수 있습니다.
// ===================================================


// --- Firebase SDK 가져오기 (CDN ES Module, v9 modular 방식) ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
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


// ===================================================
// 데이터를 다루는 함수 세 개
// Firestore를 사용하도록 바뀌었습니다.
// ===================================================

// 메모를 읽어 옵니다.
// Firestore의 실시간 리스너(onSnapshot)가 memos 배열을 자동으로 갱신하므로,
// 이 함수는 현재 메모 배열을 createdAt 순으로 정렬하여 반환합니다.
function loadMemos() {
  return memos.slice().sort(function (a, b) {
    // createdAt이 아직 서버에서 안 내려온 경우(null) 맨 뒤로 보냅니다
    const timeA = a.createdAt || Infinity;
    const timeB = b.createdAt || Infinity;
    return timeA - timeB;
  });
}

// 메모를 새로 씁니다.
// Firestore에 문서를 추가합니다. 저장이 끝나면 onSnapshot이 자동으로 화면을 갱신합니다.
async function addMemo(text) {
  await addDoc(memosCol, {
    text: text,
    createdAt: serverTimestamp()  // 서버 시각을 사용합니다
  });
}

// 메모를 지웁니다.
// Firestore에서 해당 문서를 삭제합니다. 삭제가 끝나면 onSnapshot이 자동으로 화면을 갱신합니다.
async function deleteMemo(id) {
  await deleteDoc(doc(db, "memos", id));
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

// 메모 한 장 만들기
function makeMemo(memo) {
  const div = document.createElement("div");
  div.className = "memo";

  const del = document.createElement("button");
  del.textContent = "×";
  // addEventListener 방식으로 이벤트를 등록합니다
  del.addEventListener("click", async function () {
    await deleteMemo(memo.id);
    // onSnapshot이 render()를 자동 호출하므로 여기서는 따로 부르지 않습니다
  });
  div.appendChild(del);

  const span = document.createElement("span");
  span.textContent = memo.text;
  div.appendChild(span);

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
      createdAt: data.createdAt ? data.createdAt.toMillis() : null  // Timestamp → 밀리초
    };
  });
  render();
});


// ===================================================
// 구글 로그인 / 로그아웃
// ===================================================

const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const userInfo = document.getElementById("userInfo");
const userNameSpan = document.getElementById("userName");
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

// 로그인 상태가 바뀔 때마다 화면을 갱신합니다
onAuthStateChanged(auth, function (user) {
  if (user) {
    // 로그인 상태: 이름을 보여주고, 입력 칸을 엽니다
    loginBtn.style.display = "none";
    userInfo.style.display = "inline";
    userNameSpan.textContent = "🙂 " + user.displayName + "님";
    writer.hidden = false;
    input.focus();
  } else {
    // 로그아웃 상태: 로그인 버튼만 보여줍니다
    loginBtn.style.display = "inline";
    userInfo.style.display = "none";
    userNameSpan.textContent = "";
    writer.hidden = true;
  }
});
