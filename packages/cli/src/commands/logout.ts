import pc from "picocolors";
import { deleteState } from "../state.js";

/** `shibaita logout` : ローカルのdevice token(state.json)を削除する。 */
export async function runLogout(): Promise<number> {
  await deleteState();
  console.log(pc.green("ログアウトしました。ローカルの設定を削除しました。"));
  return 0;
}
