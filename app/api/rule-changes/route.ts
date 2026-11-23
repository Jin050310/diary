import { db } from "@/lib/db";
import { handle, readJson } from "@/lib/http";
import { asObject, str } from "@/lib/validate";

// 계획 규칙을 바꾼 기록 (T07-C09~C12). 바꾼 시각은 서버(DB now())가 찍고 사용자가 정할 수 없다.
// 기록은 고치거나 지울 수 없다. (DB 트리거가 막음) 바꾼 규칙·이전 값·새 값·이유를 모두 적어야 저장된다.
export async function POST(req: Request) {
  return handle(async (user) => {
    const o = asObject(await readJson(req));
    const v = {
      rule_name: str(o, "rule_name", "바꾼 규칙", 200)!,
      old_value: str(o, "old_value", "이전 값", 200)!,
      new_value: str(o, "new_value", "새 값", 200)!,
      reason: str(o, "reason", "바꾼 이유", 1000)!,
    };
    const [row] = await db()`
      insert into rule_changes (user_id, rule_name, old_value, new_value, reason)
      values (${user.id}, ${v.rule_name}, ${v.old_value}, ${v.new_value}, ${v.reason})
      returning id, changed_at, rule_name, old_value, new_value, reason`;
    return Response.json(row, { status: 201 });
  });
}
