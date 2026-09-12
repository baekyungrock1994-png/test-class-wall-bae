// ===================================================
// Gemini에게 물어보는 서버 코드
//
// 왜 서버가 필요한가요?
//   API 키를 브라우저 코드(app.js)에 적으면 누구나 볼 수 있습니다.
//   그래서 키는 서버에만 두고, 브라우저는 이 주소로 부탁만 합니다.
//
// 왜 Firebase Functions가 아니라 여기인가요?
//   Firebase Functions는 유료 요금제(Blaze)라야 씁니다.
//   이 프로젝트는 무료 요금제(Spark)로 진행하므로,
//   서버가 필요한 일은 Vercel의 무료 함수로 처리합니다.
//
// 이 파일의 규칙
//   api 폴더 안의 파일은 Vercel에서 자동으로 서버 주소가 됩니다.
//   이 파일은 /api/gemini 주소가 됩니다.
//   API 키는 코드에 적지 말고 Vercel 환경변수 GEMINI_API_KEY에 넣습니다.
//   (https://aistudio.google.com/apikey 에서 무료로 발급받을 수 있습니다)
//
// 여기서 쓰는 모델(gemini-3.6-flash)은 Google AI Studio 무료 사용량 안에서 쓸 수 있습니다.
// (Google이 모델을 자주 교체하니, 나중에 "no longer available" 에러가 뜨면
//  에러 메시지가 알려주는 새 모델 이름으로 이 값만 바꿔주면 됩니다)
// ===================================================

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST로 요청해 주세요." });
    return;
  }

  const text = req.body && req.body.text;
  if (typeof text !== "string" || text.trim() === "") {
    res.status(400).json({ error: "코멘트를 달 메모 내용(text)이 없습니다." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다." });
    return;
  }

  // 학생의 uid·이메일 같은 개인 식별 정보는 보내지 않고, 메모 내용만 보냅니다.
  const prompt =
    "너는 초등학교 담임 선생님을 돕는 다정한 도우미야. " +
    "다음은 학생이 우리 반 담벼락에 남긴 메모야. " +
    "선생님이 답글로 남길 만한, 짧고 따뜻한 격려 댓글을 한국어로 1~2문장만 만들어 줘. " +
    "메모 내용: \"" + text + "\"";

  try {
    const model = "gemini-3.6-flash";
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      model +
      ":generateContent?key=" +
      apiKey;

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error("Gemini 오류:", data);
      // Google이 알려준 진짜 이유를 그대로 보여줍니다. (예: API 키가 잘못됨, 모델을 찾을 수 없음 등)
      const reason = (data && data.error && data.error.message) || ("상태 코드 " + geminiRes.status);
      res.status(502).json({ error: "Gemini 호출에 실패했습니다: " + reason });
      return;
    }

    const comment =
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!comment) {
      res.status(502).json({ error: "AI가 코멘트를 만들지 못했습니다." });
      return;
    }

    res.status(200).json({ comment: comment.trim() });
  } catch (error) {
    console.error("Gemini 호출 중 오류:", error);
    res.status(500).json({ error: "AI 코멘트를 가져오는 중 오류가 발생했습니다." });
  }
}
