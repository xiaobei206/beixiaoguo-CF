import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SDK_REPOSITORY = "xiaobei206/openhongguo";
const SDK_GIT_URL = "https://github.com/xiaobei206/openhongguo.git";
const SDK_REF = process.env.BXG_OPENHONGGUO_REF?.trim() || "main";
const GO_VERSION = "1.27.4";
const GO_SHA256 = {
  x64: "7226736c2339719cda28fbf3a54d71aa63bcefe376e98cef00034268dab24840",
  arm64: "3392582988a273a87ab5043ee8a273a87ab5043ee8a273a87ab5043ee8a273a87"
};
const ROOT = process.cwd();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(command + " " + args.join(" ") + " failed with exit code " + result.status);
  }
}

function capture(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true
  }).stdout.trim();
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function installPinnedGo(workDir) {
  const current = spawnSync("go", ["version"], { encoding: "utf8" });
  if (current.status === 0 && current.stdout?.includes("go" + GO_VERSION)) {
    return { command: "go", pathPrefix: "", version: current.stdout.trim() };
  }

  if (process.platform !== "linux") {
    if (current.status === 0 && /go1\.(2[2-9]|[3-9]\d)\./.test(current.stdout || "")) {
      return { command: "go", pathPrefix: "", version: current.stdout.trim() };
    }
    throw new Error("未检测到兼容的 Go 工具链；本地非 Linux 构建请安装 Go " + GO_VERSION + "。");
  }

  const checksum = GO_SHA256[process.arch];
  if (!checksum) throw new Error("暂不支持自动安装 Go 的架构：" + process.arch);

  const goArch = process.arch === "arm64" ? "arm64" : "amd64";
  const archiveName = "go" + GO_VERSION + ".linux-" + goArch + ".tar.gz";
  const archivePath = join(workDir, archiveName);
  const downloadUrl = "https://go.dev/dl/" + archiveName;
  console.log("[openhongguo] 下载 Go " + GO_VERSION + "：" + downloadUrl);
  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error("下载 Go 工具链失败：HTTP " + response.status);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archivePath));
  const actual = await sha256File(archivePath);
  if (actual !== checksum) {
    throw new Error("Go 工具链 SHA-256 校验失败；expected=" + checksum + " actual=" + actual);
  }

  const toolchainRoot = join(workDir, "toolchain");
  await mkdir(toolchainRoot, { recursive: true });
  run("tar", ["-xzf", archivePath, "-C", toolchainRoot]);
  const goRoot = join(toolchainRoot, "go");
  const goBin = join(goRoot, "bin", "go");
  const version = capture(goBin, ["version"]);
  if (!version.includes("go" + GO_VERSION)) throw new Error("安装后的 Go 版本不匹配：" + version);
  return { command: goBin, pathPrefix: join(goRoot, "bin"), version };
}

const workDir = await mkdtemp(join(tmpdir(), "bxg-openhongguo-build-"));
try {
  const go = await installPinnedGo(workDir);
  const env = {
    ...process.env,
    GOTOOLCHAIN: "local",
    PATH: [go.pathPrefix, process.env.PATH || ""].filter(Boolean).join(process.platform === "win32" ? ";" : ":")
  };
  const sdkDir = join(workDir, "openhongguo");

  console.log("[openhongguo] 克隆自有仓库：" + SDK_GIT_URL + "（" + SDK_REF + "）");
  run("git", ["clone", "--depth", "1", "--branch", "main", "--single-branch", SDK_GIT_URL, sdkDir]);
  if (SDK_REF !== "main") {
    run("git", ["fetch", "--depth", "1", "origin", SDK_REF], { cwd: sdkDir });
    run("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: sdkDir });
  }
  const commit = capture("git", ["rev-parse", "HEAD"], { cwd: sdkDir });
  const remote = capture("git", ["remote", "get-url", "origin"], { cwd: sdkDir });
  if (!remote.includes("github.com/xiaobei206/openhongguo")) {
    throw new Error("SDK 来源校验失败，拒绝使用非本人仓库：" + remote);
  }

  const requiredSource = [
    ["sdk/media.go", "resolveVideoTab", "签名 video_tab 备用播放通道"],
    ["sdk/media.go", "ensurePlaybackDeviceActivated", "播放前设备激活"],
    ["sdk/client.go", "ensureDeviceHeartbeat", "设备心跳与 EGDI 刷新"],
    ["sdk/client.go", "KlinkEGDI", "匿名设备 EGDI 身份传递"],
    ["sdk/device.go", "KlinkEGDI", "匿名设备档案持久化 EGDI"],
    ["internal/protocol/register.go", "klink_egdi", "注册响应 EGDI 解析"],
    ["internal/protocol/playback_v5.go", "KlinkEGDI", "V5 播放签名查询参数"]
  ];
  for (const [path, token, label] of requiredSource) {
    const source = await readFile(join(sdkDir, path), "utf8");
    if (!source.includes(token)) {
      throw new Error("自有 openhongguo 源码缺少 " + label + "（" + path + "）；拒绝构建旧播放实现。");
    }
  }

  console.log("[openhongguo] Go 静态检查与单元测试：" + commit);
  run(go.command, ["vet", "./..."], { cwd: sdkDir, env });
  run(go.command, ["test", "./..."], { cwd: sdkDir, env });

  console.log("[openhongguo] 执行自有仓库的 Node/WASM 构建脚本");
  run(process.execPath, ["bindings/node/scripts/build.mjs"], { cwd: sdkDir, env });

  const packageRoot = join(ROOT, "node_modules", "openhongguo");
  await rm(packageRoot, { recursive: true, force: true });
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  const copies = [
    ["bindings/node/index.js", "index.js"],
    ["bindings/node/index.d.ts", "index.d.ts"],
    ["bindings/node/types.d.ts", "types.d.ts"],
    ["bindings/node/package.json", "package.json"],
    ["bindings/node/README.md", "README.md"],
    ["bindings/node/GO_LICENSE", "GO_LICENSE"],
    ["bindings/node/LICENSE", "LICENSE"],
    ["bindings/node/dist/openhongguo.wasm", "dist/openhongguo.wasm"],
    ["bindings/node/dist/wasm_exec.js", "dist/wasm_exec.js"]
  ];
  for (const [from, to] of copies) {
    const source = join(sdkDir, from);
    const target = join(packageRoot, to);
    await mkdir(join(target, ".."), { recursive: true });
    await copyFile(source, target);
  }

  const packageInfo = JSON.parse(await readFile(join(sdkDir, "bindings/node/package.json"), "utf8"));
  const buildInfo = {
    repository: SDK_REPOSITORY,
    ref: SDK_REF,
    commit,
    goVersion: go.version.match(/go\d+\.\d+(?:\.\d+)?/)?.[0] || go.version,
    packageVersion: packageInfo.version,
    playbackFallback: "video_tab",
    deviceActivation: true,
    deviceHeartbeat: true,
    serverIssuedEGDI: true
  };
  await writeFile(
    join(packageRoot, "bxg-build-info.js"),
    "export const openhongguoBuild = Object.freeze(" + JSON.stringify(buildInfo) + ");\n",
    "utf8"
  );

  const wasm = await readFile(join(packageRoot, "dist/openhongguo.wasm"));
  if (wasm.byteLength < 100_000) throw new Error("自有 openhongguo WASM 产物异常过小：" + wasm.byteLength);
  console.log("[openhongguo] 已安装自有源码构建产物：" + JSON.stringify({ ...buildInfo, wasmBytes: wasm.byteLength }));
} finally {
  await rm(workDir, { recursive: true, force: true });
}
