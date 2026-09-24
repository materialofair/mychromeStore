const note = document.querySelector("#note");
const saved = document.querySelector("#saved");
const version = chrome.runtime.getManifest().version;
document.querySelector("#version").textContent = `v${version}`;
function count() {
  document.querySelector("#count").textContent = `${note.value.length} / 5000`;
}
chrome.storage.local
  .get(["note", "theme"])
  .then((data) => {
    note.value = typeof data.note === "string" ? data.note : "";
    document.body.classList.toggle("rose", data.theme === "rose");
    saved.textContent = "已保存在此浏览器";
    count();
    note.disabled = false;
    document.querySelector("#theme").disabled = false;
  })
  .catch(() => {
    saved.textContent = "读取失败，请重新打开";
    note.disabled = true;
  });
let queue = Promise.resolve();
note.addEventListener("input", () => {
  count();
  saved.textContent = "正在保存…";
  const value = note.value;
  queue = queue
    .then(() => chrome.storage.local.set({ note: value }))
    .then(() => {
      if (value === note.value) saved.textContent = "已保存在此浏览器";
    })
    .catch(() => {
      saved.textContent = "保存失败，请复制笔记后重试";
    });
});
if (version !== "1.0.0") document.querySelector("#new-feature").hidden = false;
document.querySelector("#theme").addEventListener("click", async () => {
  const rose = !document.body.classList.contains("rose");
  try {
    await chrome.storage.local.set({ theme: rose ? "rose" : "paper" });
    document.body.classList.toggle("rose", rose);
  } catch {
    saved.textContent = "纸张设置保存失败";
  }
});
