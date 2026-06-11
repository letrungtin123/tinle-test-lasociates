// ============================================================
// Blocks & XBlock Content API
// ============================================================

import { apiClient } from "./client";
import type { Block } from "./types";

/**
 * Lấy chi tiết block đơn lẻ (video, problem, html, etc.).
 */
export async function getBlockDetail(usageKey: string, username?: string): Promise<Block> {
  const { data } = await apiClient.get<any>(
    `/api/courses/v1/blocks/${usageKey}/`,
    {
      params: {
        requested_fields:
          "student_view_data,display_name,type,children,completion",
        student_view_data: "video,html,la_crossword,la_sortable,la_diagram,la_faq,la_pdf,la_single_quiz,la_multi_quiz",
        ...(username ? { username } : {}),
      },
    }
  );
  // Open edX blocks API rertuns { root: "...", blocks: { "...": Block } }
  if (data && data.blocks && data.blocks[usageKey]) {
    return data.blocks[usageKey] as Block;
  }
  return data as Block;
}

/**
 * Lấy rendered HTML content qua Courseware Sequence API.
 */
export interface SequenceContent {
  items: Array<{
    id: string;
    content: string;
    type: string;
  }>;
}

export async function getSequenceContent(
  sequenceId: string
): Promise<SequenceContent> {
  const { data } = await apiClient.get<SequenceContent>(
    `/api/courseware/sequence/${sequenceId}`
  );
  return data;
}

// ── Helper: Trích courseKey từ usageKey ──
// block-v1:Org+Course+Run+type@problem+block@id → course-v1:Org+Course+Run
function extractCourseKey(usageKey: string): string {
  const match = usageKey.match(/^block-v1:(.+?)\+type@/);
  if (match) {
    return `course-v1:${match[1]}`;
  }
  return usageKey.replace(/^block-v1:/, "course-v1:").replace(/\+type@.*$/, "");
}

/**
 * Lấy rendered HTML content của XBlock.
 *
 * Dùng xblock_view API (Bearer auth, JSON response):
 *   GET /courses/{courseKey}/xblock/{usageKey}/view/student_view
 *   → { html: "...", resources: [...], csrf_token: "..." }
 *
 * Feature flag cần bật: FEATURES["ENABLE_XBLOCK_VIEW_ENDPOINT"] = True
 * (đã bật qua Tutor plugin la_custom_settings)
 *
 * Ưu điểm so với /xblock/ endpoint:
 * - Dùng Bearer auth (không cần session cookie)
 * - Trả JSON chuẩn (dễ parse)
 * - Sử dụng @view_auth_classes (tương thích OAuth2)
 */
export async function getXBlockHtml(
  usageKey: string
): Promise<string> {
  const courseKey = extractCourseKey(usageKey);

  const { data } = await apiClient.get<{ html: string; resources: unknown[]; csrf_token: string }>(
    `/courses/${courseKey}/xblock/${usageKey}/view/student_view`
  );

  if (data?.html) {
    console.log("[getXBlockHtml] ✅ Got HTML via xblock_view API, length:", data.html.length);
    return data.html;
  }

  throw new Error("xblock_view API returned empty HTML");
}

/**
 * Submit đáp án quiz/problem.
 * Dùng xmodule_handler endpoint.
 */
export async function submitProblemAnswer(
  usageKey: string,
  answers: Record<string, string | string[]>
): Promise<Record<string, unknown>> {
  const courseKey = extractCourseKey(usageKey);

  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(answers)) {
    if (Array.isArray(val)) {
      val.forEach((v) => params.append(key, v));
    } else {
      params.append(key, val);
    }
  }

  const { data } = await apiClient.post(
    `/courses/${courseKey}/xblock/${usageKey}/handler/xmodule_handler/problem_check`,
    params,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  return data;
}

/**
 * Submit đáp án Đố Vui Ô Chữ.
 * Dùng XBlock json_handler 'submit_answers'
 */
export async function submitCrosswordAnswer(
  usageKey: string,
  answers: Record<string, string>
): Promise<{ status: string; message: string; score?: number }> {
  const courseKey = extractCourseKey(usageKey);

  const { data } = await apiClient.post(
    `/courses/${courseKey}/xblock/${usageKey}/handler/submit_answers`,
    { answers },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  return data;
}

/**
 * Submit đáp án Sắp Xếp Đúng Thứ Tự.
 * Dùng XBlock json_handler 'submit_answers'
 */
export async function submitSortableAnswer(
  usageKey: string,
  answer: number[]
): Promise<{ status: string; message: string; score?: number }> {
  const courseKey = extractCourseKey(usageKey);

  const { data } = await apiClient.post(
    `/courses/${courseKey}/xblock/${usageKey}/handler/submit_answers`,
    { answer },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  return data;
}

/**
 * Submit đáp án Quiz 1 đáp án (la_single_quiz).
 * Dùng XBlock json_handler 'submit_answers'
 */
export async function submitSingleQuizAnswer(
  usageKey: string,
  answer: string
): Promise<{ status: string; message: string }> {
  const courseKey = extractCourseKey(usageKey);

  const { data } = await apiClient.post(
    `/courses/${courseKey}/xblock/${usageKey}/handler/submit_answers`,
    { answer },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  return data;
}

/**
 * Submit đáp án Quiz nhiều đáp án (la_multi_quiz).
 * Dùng XBlock json_handler 'submit_answers'
 */
export async function submitMultiQuizAnswer(
  usageKey: string,
  answers: string[]
): Promise<{ status: string; message: string }> {
  const courseKey = extractCourseKey(usageKey);

  const { data } = await apiClient.post(
    `/courses/${courseKey}/xblock/${usageKey}/handler/submit_answers`,
    { answers },
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
  return data;
}

/**
 * Lấy hint từ Open edX (demand hint).
 * Open edX handle_ajax expects request.POST (form-encoded data), NOT JSON.
 * Response format: { success: true, hint_index: N, should_enable_next_hint: bool, msg: "<html>..." }
 */
export async function fetchHint(
  usageKey: string,
  hintIndex: number = 0
): Promise<{ hint: string; hasMoreHints: boolean }> {
  const courseKey = extractCourseKey(usageKey);

  try {
    // MUST send as form-encoded data (application/x-www-form-urlencoded)
    // edX handle_ajax uses request.POST which is webob.multidict.MultiDict
    const formData = new URLSearchParams();
    formData.append("hint_index", String(hintIndex));

    const { data } = await apiClient.post(
      `/courses/${courseKey}/xblock/${usageKey}/handler/xmodule_handler/hint_button`,
      formData,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    // edX returns: { success: true, hint_index: N, should_enable_next_hint: bool, msg: "<ol>...</ol>" }
    // 'msg' contains the hint HTML, NOT 'contents'
    const hintHtml = data?.msg || "";
    const shouldEnableNext = data?.should_enable_next_hint ?? false;

    return {
      hint: hintHtml,
      hasMoreHints: shouldEnableNext,
    };
  } catch (error) {
    console.error("[fetchHint] Failed:", error);
    return { hint: "", hasMoreHints: false };
  }
}

/**
 * Lấy giải thích đáp án (explanation/solution) từ Open edX.
 * 
 * Trong edX, explanation KHÔNG nằm trong response của problem_check (submit).
 * Explanation chỉ có thể lấy qua endpoint problem_show (handler "Show Answer"):
 *   POST /courses/{course}/xblock/{usage}/handler/xmodule_handler/problem_show
 *   → { answers: { input_id: "html_with_solution" }, correct_status_html: "..." }
 * 
 * Mỗi answer value có thể chứa <div class="detailed-solution">...</div> 
 * hoặc trực tiếp là text giải thích. Ngoài ra, edX JS inject answer vào 
 * #solution_{id} span (class="solution-span").
 * 
 * Lưu ý: endpoint này chỉ trả về kết quả nếu quiz setting "Show Answer" cho phép
 * (e.g. "Always", "Attempted", "Answered", etc.).
 * Nếu không được phép → trả về 404/error.
 */
export async function fetchExplanation(
  usageKey: string
): Promise<{ explanationHtml: string; answers: Record<string, string> }> {
  const courseKey = extractCourseKey(usageKey);

  try {
    const { data } = await apiClient.post(
      `/courses/${courseKey}/xblock/${usageKey}/handler/xmodule_handler/problem_show`,
      new URLSearchParams(), // empty form data
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    // data = { answers: { "input_id": "<html>..." }, correct_status_html: "..." }
    const answers: Record<string, string> = {};
    let explanationHtml = "";

    if (data?.answers && typeof data.answers === "object") {
      const parser = new DOMParser();
      
      for (const [key, value] of Object.entries(data.answers)) {
        const answerStr = String(value);
        answers[key] = answerStr;
        
        // Try to extract .detailed-solution from the answer HTML
        if (answerStr.includes("<")) {
          const doc = parser.parseFromString(answerStr, "text/html");
          const solution = doc.querySelector(".detailed-solution");
          if (solution && solution.textContent?.trim()) {
            let html = solution.innerHTML;
            // Làm sạch và Việt hóa chữ "Explanation" mặc định của Open edX
            html = html.replace(/>\s*Explanation\s*</gi, ">Giải thích: <");
            html = html.replace(/(^|>|<br\s*\/?>|\s)Explanation(?![\w])/g, "$1Giải thích:");
            explanationHtml = html;
          }
        }
      }
    }

    return { explanationHtml, answers };
  } catch (error) {
    console.error("[fetchExplanation] Failed:", error);
    return { explanationHtml: "", answers: {} };
  }
}
