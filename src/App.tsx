import { useEffect, useRef, useState } from "react";
import { githubConfig } from "./config";
import "./App.css";

type Side = { text: string; audio?: string };
type Card = { id: string; front: Side; back: Side };
type FileNode = {
  id: string;
  type: "file";
  name: string;
  description?: string;
  icon?: string;
  cards: Card[];
};
type FolderNode = {
  id: string;
  type: "folder";
  name: string;
  icon?: string;
  children: Node[];
};
type Node = FileNode | FolderNode;
type Tree = FolderNode;

const sampleTree: Tree = {
  id: "root",
  type: "folder",
  name: "Tất cả chủ đề",
  icon: "✦",
  children: [
    {
      id: "space",
      type: "folder",
      name: "Vũ trụ & khoa học",
      icon: "✺",
      children: [
        {
          id: "space-basics",
          type: "file",
          name: "Space basics",
          description: "Những từ đầu tiên để đọc về vũ trụ.",
          icon: "☄",
          cards: [
            { id: "c1", front: { text: "quỹ đạo" }, back: { text: "orbit" } },
            {
              id: "c2",
              front: { text: "hành tinh" },
              back: { text: "planet" },
            },
            {
              id: "c3",
              front: { text: "phi hành gia" },
              back: { text: "astronaut" },
            },
            { id: "c4", front: { text: "thiên hà" }, back: { text: "galaxy" } },
            {
              id: "c5",
              front: { text: "kính viễn vọng" },
              back: { text: "telescope" },
            },
          ],
        },
      ],
    },
    {
      id: "daily",
      type: "folder",
      name: "Đời sống hằng ngày",
      icon: "⌂",
      children: [
        {
          id: "travel",
          type: "file",
          name: "Travel essentials",
          description: "Từ vựng hữu ích cho những chuyến đi.",
          icon: "✈",
          cards: [
            {
              id: "c6",
              front: { text: "hộ chiếu" },
              back: { text: "passport" },
            },
            { id: "c7", front: { text: "sân bay" }, back: { text: "airport" } },
            {
              id: "c8",
              front: { text: "đặt phòng" },
              back: { text: "reservation" },
            },
          ],
        },
      ],
    },
    {
      id: "starter",
      type: "file",
      name: "Starter pack",
      description: "Bộ thẻ khởi động ngắn gọn.",
      icon: "◈",
      cards: [
        { id: "c9", front: { text: "tập trung" }, back: { text: "focus" } },
        { id: "c10", front: { text: "tiến bộ" }, back: { text: "progress" } },
      ],
    },
  ],
};
const flatNodes = (node: Node): Node[] => [
  node,
  ...(node.type === "folder" ? node.children.flatMap(flatNodes) : []),
];
const findNode = (tree: Tree, id: string) =>
  flatNodes(tree).find((node) => node.id === id);
const allFiles = (tree: Tree) =>
  flatNodes(tree).filter((node): node is FileNode => node.type === "file");
const go = (path: string) => {
  window.location.hash = path;
};
const shuffled = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
const addChild = (
  node: FolderNode,
  parentId: string,
  child: Node,
): FolderNode => ({
  ...node,
  children:
    node.id === parentId
      ? [...node.children, child]
      : node.children.map((item) =>
          item.type === "folder" ? addChild(item, parentId, child) : item,
        ),
});
const renameNode = (
  node: FolderNode,
  id: string,
  name: string,
): FolderNode => ({
  ...node,
  name: node.id === id ? name : node.name,
  children: node.children.map((item) =>
    item.type === "folder"
      ? renameNode(item, id, name)
      : item.id === id
        ? { ...item, name }
        : item,
  ),
});
const removeNode = (node: FolderNode, id: string): FolderNode => ({
  ...node,
  children: node.children
    .filter((item) => item.id !== id)
    .map((item) => (item.type === "folder" ? removeNode(item, id) : item)),
});
const loadInitialTree = (): Tree => {
  const saved = localStorage.getItem("vocab-tree");
  if (!saved) return sampleTree;
  try {
    return JSON.parse(saved) as Tree;
  } catch {
    return sampleTree;
  }
};

function App() {
  const [tree, setTree] = useState<Tree>(loadInitialTree);
  const [route, setRoute] = useState(
    window.location.hash.slice(1) || "/browse/root",
  );
  const [toast, setToast] = useState("");
  useEffect(() => {
    const listener = () =>
      setRoute(window.location.hash.slice(1) || "/browse/root");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 2600);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const updateTree = (next: Tree) => {
    setTree(next);
    localStorage.setItem("vocab-tree", JSON.stringify(next));
    setToast("Đã lưu bản nháp trên thiết bị");
  };
  if (route.startsWith("/admin"))
    return <Admin tree={tree} updateTree={updateTree} toast={setToast} />;
  const game = route.match(/^\/file\/([^/]+)\/game/);
  const learn = route.match(/^\/file\/([^/]+)\/learn/);
  const fileRoute = route.match(/^\/file\/([^/]+)/);
  if (game) {
    const node = findNode(tree, game[1]);
    return (
      <Shell tree={tree}>
        <Game file={node?.type === "file" ? node : allFiles(tree)[0]} />
      </Shell>
    );
  }
  if (learn) {
    const node = findNode(tree, learn[1]);
    return (
      <Shell tree={tree}>
        <Learn file={node?.type === "file" ? node : allFiles(tree)[0]} />
      </Shell>
    );
  }
  if (fileRoute) {
    const node = findNode(tree, fileRoute[1]);
    return (
      <Shell tree={tree}>
        <FileChoice file={node?.type === "file" ? node : allFiles(tree)[0]} />
      </Shell>
    );
  }
  const folderId = route.match(/^\/browse\/?([^/]*)/)?.[1] || "root";
  return (
    <Shell tree={tree}>
      <Browse tree={tree} folderId={folderId} />
    </Shell>
  );
}

function Shell({ children, tree }: { children: React.ReactNode; tree: Tree }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => go("/browse/root")}>
          <span className="brand-mark">v</span>
          <span>
            vocab<span className="accent">lab</span>
          </span>
        </button>
        <div className="top-actions">
          <span className="sync-dot" /> Đã đồng bộ
        </div>
      </header>
      <main>{children}</main>
      <footer>
        <span>
          vocab<span className="accent">lab</span> · học một chút, nhớ lâu hơn
        </span>
        <span>{allFiles(tree).length} bộ học</span>
      </footer>
    </div>
  );
}
function Breadcrumb({ tree, folderId }: { tree: Tree; folderId: string }) {
  const path: FolderNode[] = [];
  const walk = (node: FolderNode): boolean => {
    if (node.id === folderId) {
      path.push(node);
      return true;
    }
    for (const child of node.children)
      if (child.type === "folder" && walk(child)) {
        path.unshift(node);
        return true;
      }
    return false;
  };
  walk(tree);
  return (
    <div className="breadcrumb">
      {path.map((item, i) => (
        <span key={item.id}>
          <button onClick={() => go(`/browse/${item.id}`)}>
            {i === 0 ? "Tất cả chủ đề" : item.name}
          </button>
          {i < path.length - 1 && <b>/</b>}
        </span>
      ))}
    </div>
  );
}
function Browse({ tree, folderId }: { tree: Tree; folderId: string }) {
  const node = findNode(tree, folderId);
  const folder = node?.type === "folder" ? node : tree;
  return (
    <section className="page">
      <Breadcrumb tree={tree} folderId={folder.id} />
      <div className="page-heading">
        <div>
          <p className="eyebrow">THƯ VIỆN TỪ VỰNG</p>
          <h1>{folder.name}</h1>
          <p className="muted">Chọn một chủ đề để bắt đầu phiên học 10 phút.</p>
        </div>
        <div className="stat-pill">
          <strong>{folder.children.length}</strong>
          <span>mục trong thư mục</span>
        </div>
      </div>
      <div className="node-grid">
        {folder.children.map((item) => (
          <button
            className="node-card"
            key={item.id}
            onClick={() =>
              item.type === "folder"
                ? go(`/browse/${item.id}`)
                : go(`/file/${item.id}`)
            }
          >
            <span className="node-icon">
              {item.icon || (item.type === "folder" ? "◇" : "▤")}
            </span>
            <span className="node-title">{item.name}</span>
            <span className="node-meta">
              {item.type === "folder"
                ? `${item.children.length} bộ học`
                : `${item.cards.length} thẻ`}
            </span>
            <span className="node-arrow">↗</span>
          </button>
        ))}
      </div>
      <div className="quote-strip">
        <span className="quote-mark">“</span>
        <span>Mỗi từ mới là một cánh cửa nhỏ mở ra thế giới lớn hơn.</span>
        <span className="quote-line" />
      </div>
    </section>
  );
}
function FileChoice({ file }: { file: FileNode }) {
  return (
    <section className="page choice-page">
      <button className="back-link" onClick={() => go("/browse/root")}>
        ← Thư viện
      </button>
      <div className="choice-layout">
        <div>
          <span className="big-icon">{file.icon || "▤"}</span>
          <p className="eyebrow">BỘ TỪ VỰNG</p>
          <h1>{file.name}</h1>
          <p className="lead">{file.description}</p>
          <div className="choice-count">
            <strong>{String(file.cards.length).padStart(2, "0")}</strong>
            <span>
              thẻ được chuẩn bị
              <br />
              cho phiên học này
            </span>
          </div>
        </div>
        <div className="mode-panel">
          <p className="eyebrow">CHỌN CÁCH HỌC</p>
          <button
            className="mode-button dark"
            onClick={() => go(`/file/${file.id}/learn`)}
          >
            <span>01</span>
            <div>
              <strong>Học bằng flashcard</strong>
              <small>Lật thẻ, nghe phát âm, ghi nhớ chủ động</small>
            </div>
            <b>→</b>
          </button>
          <button
            className="mode-button light"
            onClick={() => go(`/file/${file.id}/game`)}
          >
            <span>02</span>
            <div>
              <strong>Mưa từ vựng</strong>
              <small>Gõ nhanh, phá box, giữ combo</small>
            </div>
            <b>→</b>
          </button>
        </div>
      </div>
    </section>
  );
}
function AudioButton({ src }: { src?: string }) {
  return (
    <span
      className={`audio-button ${src ? "" : "muted-audio"}`}
      onClick={(event) => {
        event.stopPropagation();
        if (src) new Audio(src).play();
      }}
    >
      ◖
    </span>
  );
}
function Learn({ file }: { file: FileNode }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [cards, setCards] = useState(file.cards);
  const card = cards[index];
  const next = (delta: number) => {
    setIndex((index + delta + cards.length) % cards.length);
    setFlipped(false);
  };
  return (
    <section className="page learn-page">
      <div className="mode-top">
        <button className="back-link" onClick={() => go(`/file/${file.id}`)}>
          ← {file.name}
        </button>
        <div className="mode-tabs">
          <button className="active">Học</button>
          <button onClick={() => go(`/file/${file.id}/game`)}>Game</button>
        </div>
      </div>
      <div className="learn-head">
        <div>
          <p className="eyebrow">PHIÊN HỌC · {file.name.toUpperCase()}</p>
          <h1>Nhẹ nhàng mà nhớ lâu.</h1>
        </div>
        <button
          className="outline-button"
          onClick={() => setCards([...cards].sort(() => Math.random() - 0.5))}
        >
          ⤨ Xáo trộn
        </button>
      </div>
      <div className="progress-row">
        <span>
          {String(index + 1).padStart(2, "0")} /{" "}
          {String(cards.length).padStart(2, "0")}
        </span>
        <div className="progress">
          <i style={{ width: `${((index + 1) / cards.length) * 100}%` }} />
        </div>
        <span>{Math.round(((index + 1) / cards.length) * 100)}%</span>
      </div>
      <button
        className={`flashcard ${flipped ? "is-flipped" : ""}`}
        onClick={() => setFlipped(!flipped)}
      >
        <div className="card-face front">
          <span className="face-label">GỢI Ý</span>
          <strong>{card.front.text}</strong>
          <AudioButton src={card.front.audio} />
        </div>
        <div className="card-face back">
          <span className="face-label">ĐÁP ÁN</span>
          <strong>{card.back.text}</strong>
          <AudioButton src={card.back.audio} />
        </div>
        <span className="flip-hint">↻ chạm để lật</span>
      </button>
      <div className="learn-controls">
        <button onClick={() => next(-1)}>← Trước</button>
        <button className="primary-button" onClick={() => next(1)}>
          Tiếp theo →
        </button>
      </div>
    </section>
  );
}

type Falling = Card & {
  x: number;
  progress: number;
  typed: number;
  born: number;
};
function Game({ file }: { file: FileNode }) {
  const [active, setActive] = useState<Falling[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deck, setDeck] = useState<Card[]>(() =>
    shuffled([...file.cards, ...file.cards, ...file.cards]),
  );
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const INITIAL_LIVES = Math.max(1, Math.floor((file.cards.length * 3) / 10));
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [done, setDone] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [runId, setRunId] = useState(0);
  const hasSpawnedRef = useRef(false);
  const FALL_SPEED = 0.44;
  const SPAWN_INTERVAL_MS = 3500;
  const speed = FALL_SPEED + Math.floor(combo / 5) * 0.07;
  useEffect(() => {
    if (done) return;
    const timer = setInterval(
      () =>
        setActive((items) => {
          if (!items.length) return items;
          const moved = items.map((item) => ({
            ...item,
            progress: item.progress + speed,
          }));
          const fallen = moved.filter((item) => item.progress >= 100);
          if (fallen.length) {
            const fallenCount = new Set(fallen.map((item) => item.id)).size;
            setLives((life) => {
              const next = life - fallenCount;
              if (next <= 0) setDone(true);
              return Math.max(0, next);
            });
            setCombo(0);
          }
          return moved.filter((item) => item.progress < 100);
        }),
      120,
    );
    return () => clearInterval(timer);
  }, [done, speed]);
  useEffect(() => {
    if (done || !deck.length) return;
    const spawnTimer = window.setTimeout(() => {
      const [card, ...rest] = deck;
      if (!card) return;
      const now = Date.now();
      const spawnedId = `${card.id}-${now}`;
      setDeck(rest);
      setActiveId((currentId) => currentId ?? spawnedId);
      setActive((boxes) => [
        ...boxes,
        {
          ...card,
          id: spawnedId,
          x: 7 + Math.random() * 82,
          progress: -4,
          typed: 0,
          born: now,
        },
      ]);
      hasSpawnedRef.current = true;
    }, hasSpawnedRef.current ? SPAWN_INTERVAL_MS : 0);
    return () => window.clearTimeout(spawnTimer);
  }, [deck, done, runId]);
  const current = active.find((item) => item.id === activeId) ?? active[0];
  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (done || !current || event.key.length !== 1) return;
    const expected = current.back.text[current.typed];
    if (event.key.toLowerCase() === expected.toLowerCase()) {
      const updated = { ...current, typed: current.typed + 1 };
      if (updated.typed === updated.back.text.length) {
        setScore((v) => v + 100 + combo * 15);
        setCombo((v) => v + 1);
        setCompleted((v) => v + 1);
        const remaining = active.filter((item) => item.id !== current.id);
        setActive(remaining);
        setActiveId(remaining[0]?.id ?? null);
        if (updated.back.audio)
          new Audio(updated.back.audio).play().catch(() => {});
      } else {
        setActive((items) =>
          items.map((item) => (item.id === current.id ? updated : item)),
        );
      }
    } else {
      setWrong(true);
      setTimeout(() => setWrong(false), 180);
    }
  };
  const reset = () => {
    hasSpawnedRef.current = false;
    setRunId((value) => value + 1);
    setActive([]);
    setActiveId(null);
    setDeck(shuffled([...file.cards, ...file.cards, ...file.cards]));
    setScore(0);
    setCombo(0);
    setLives(INITIAL_LIVES);
    setCompleted(0);
    setDone(false);
  };
  return (
    <section className="game-page">
      <div className="game-header">
        <div>
          <button className="back-link" onClick={() => go(`/file/${file.id}`)}>
            ← Thoát game
          </button>
          <p className="eyebrow">MƯA TỪ VỰNG</p>
          <h1>Gõ để phá.</h1>
        </div>
        <div className="game-hud">
          <div>
            <small>ĐIỂM</small>
            <strong>{String(score).padStart(4, "0")}</strong>
          </div>
          <div>
            <small>COMBO</small>
            <strong className="orange">×{combo}</strong>
          </div>
          <div>
            <small>MẠNG</small>
            <strong className="lives">
              {"●".repeat(lives)}
              <i>{"●".repeat(Math.max(0, INITIAL_LIVES - lives))}</i>
            </strong>
          </div>
        </div>
      </div>
      <div
        className={`rain-arena ${wrong ? "shake" : ""}`}
        onClick={(event) =>
          (
            event.currentTarget.querySelector("input") as HTMLInputElement
          )?.focus()
        }
      >
        {active.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`rain-box ${item.id === current?.id ? "target" : ""}`}
            style={{ left: `${item.x}%`, top: `${item.progress}%` }}
            onClick={(event) => {
              event.stopPropagation();
              setActiveId(item.id);
              (event.currentTarget.closest(".rain-arena")?.querySelector(
                "input",
              ) as HTMLInputElement | null)?.focus();
            }}
          >
            <span>{item.front.text}</span>
            <b>
              {item.back.text.split("").map((letter, i) => (
                <em key={i} className={i < item.typed ? "typed" : ""}>
                  {i < item.typed ? letter : "·"}
                </em>
              ))}
            </b>
          </button>
        ))}
        <div className="player">⌁</div>
        <input autoFocus aria-label="Gõ đáp án" onKeyDown={keyDown} />
      </div>
      <div className="game-tip">
        Đang chọn: <strong>{current?.front.text || "chờ box tiếp theo"}</strong>
        <span>
          Box mới bắt đầu rơi sau 1 giây · tốc độ chỉnh ở FALL_SPEED
        </span>
      </div>
      {done && (
        <div className="game-result">
          <span className="result-icon">✦</span>
          <p className="eyebrow">GAME OVER</p>
          <h2>Lần sau sẽ nhanh hơn.</h2>
          <p>
            {completed} từ đã phá · {score} điểm
          </p>
          <div>
            <button className="primary-button" onClick={reset}>
              Chơi lại
            </button>
            <button
              className="outline-button"
              onClick={() => go(`/file/${file.id}`)}
            >
              Về bộ từ
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Admin({
  tree,
  updateTree,
  toast,
}: {
  tree: Tree;
  updateTree: (tree: Tree) => void;
  toast: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Node>(tree);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState(sessionStorage.getItem("vocab-pat") || "");
  const create = (type: "folder" | "file") => {
    const parent = selected.type === "folder" ? selected : tree;
    const id = `${type}-${Date.now()}`;
    const item: Node =
      type === "folder"
        ? { id, type, name: "Folder mới", icon: "◇", children: [] }
        : {
            id,
            type,
            name: "Bộ từ mới",
            description: "Mô tả bộ từ",
            icon: "▤",
            cards: [
              {
                id: `${id}-card`,
                front: { text: "Từ mới" },
                back: { text: "new word" },
              },
            ],
          };
    updateTree(addChild(tree, parent.id, item));
    setSelected(item);
  };
  const deleteNode = (node: Node) => {
    if (node.id === tree.id) {
      toast("Không thể xóa thư mục gốc");
      return;
    }
    if (!window.confirm(`Xóa "${node.name}" và toàn bộ mục con?`)) return;
    updateTree(removeNode(tree, node.id));
    setSelected(tree);
  };
  const saveGithub = async () => {
    if (!token) {
      setTokenOpen(true);
      return;
    }
    if (!githubConfig.owner || !githubConfig.repo) {
      toast("Hãy điền owner/repo trong src/config.ts trước");
      return;
    }
    sessionStorage.setItem("vocab-pat", token);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };
    const base = `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${githubConfig.treePath}`;
    try {
      const current = await fetch(`${base}?ref=${githubConfig.branch}`, {
        headers,
      });
      const info = await current.json();
      const result = await fetch(base, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: "Update vocabulary tree",
          content: btoa(
            unescape(encodeURIComponent(JSON.stringify(tree, null, 2))),
          ),
          sha: info.sha,
          branch: githubConfig.branch,
        }),
      });
      if (!result.ok) throw Error();
      setTokenOpen(false);
      toast("Đã commit lên GitHub. Pages sẽ cập nhật sau ít phút.");
    } catch {
      toast("Không thể lưu GitHub. Kiểm tra PAT và quyền contents: write.");
    }
  };
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <button className="brand" onClick={() => go("/browse/root")}>
          <span className="brand-mark">v</span>
          <span>
            vocab<span className="accent">lab</span>
          </span>
        </button>
        <div className="admin-label">WORKSPACE</div>
        <button className="admin-nav active">⌗ Nội dung</button>
        <button className="admin-nav">◷ Hoạt động</button>
        <div className="admin-label tree-label">CÂY HỌC TẬP</div>
        <AdminTree node={tree} selected={selected.id} onSelect={setSelected} />
        <button className="back-public" onClick={() => go("/browse/root")}>
          ← Xem giao diện học
        </button>
      </aside>
      <section className="admin-content">
        <div className="admin-top">
          <div>
            <p className="eyebrow">ADMIN WORKSPACE</p>
            <h1>Biên tập nội dung</h1>
          </div>
          <div className="admin-actions">
            <button className="outline-button" onClick={() => create("folder")}>
              + Folder con
            </button>
            <button className="primary-button" onClick={() => create("file")}>
              + Bộ từ con
            </button>
            <button className="save-github" onClick={saveGithub}>
              ↑ Lưu GitHub
            </button>
          </div>
        </div>
        {selected.type === "file" ? (
          <FileEditor
            key={selected.id}
            file={selected}
            updateTree={updateTree}
            toast={toast}
            onDelete={() => deleteNode(selected)}
          />
        ) : (
          <FolderEditor
            key={selected.id}
            folder={selected}
            onSelect={setSelected}
            onRename={(nextName) => {
              if (nextName.trim()) updateTree(renameNode(tree, selected.id, nextName.trim()));
            }}
            onDelete={() => deleteNode(selected)}
          />
        )}
        {tokenOpen && (
          <div className="edit-modal">
            <div className="modal-card">
              <p className="eyebrow">GITHUB ACCESS</p>
              <h2>Dán Personal Access Token</h2>
              <p className="muted">
                Token chỉ được giữ trong session hiện tại.
              </p>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="github_pat_..."
              />
              <button className="primary-button" onClick={saveGithub}>
                Xác nhận & lưu
              </button>
              <button
                className="text-button"
                onClick={() => setTokenOpen(false)}
              >
                Hủy
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
function AdminTree({
  node,
  selected,
  onSelect,
  depth = 0,
}: {
  node: Node;
  selected: string;
  onSelect: (node: Node) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(true);
  const isFolder = node.type === "folder";
  return (
    <div>
      <button
        className={`tree-item ${selected === node.id ? "selected" : ""}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => onSelect(node)}
      >
        <span
          className="tree-toggle"
          onClick={(event) => {
            if (isFolder) {
              event.stopPropagation();
              setOpen(!open);
            }
          }}
        >
          {isFolder ? (open ? "⌄" : "›") : "·"}
        </span>
        <span>{node.icon || (isFolder ? "◇" : "▤")}</span>
        <span>{node.name}</span>
        {node.id.startsWith("folder-") || node.id.startsWith("file-") ? (
          <em>Draft</em>
        ) : null}
      </button>
      {isFolder &&
        open &&
        node.children.map((child) => (
          <AdminTree
            key={child.id}
            node={child}
            selected={selected}
            onSelect={onSelect}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}
function FolderEditor({
  folder,
  onSelect,
  onRename,
  onDelete,
}: {
  folder: FolderNode;
  onSelect: (node: Node) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(folder.name);
  return (
    <div className="editor folder-editor">
      <div className="editor-heading">
        <div>
          <span className="file-badge">
            ◇ FOLDER / {folder.children.length} MỤC CON
          </span>
          <input
            className="title-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="desc-input">Các folder và file bên trong folder này</p>
        </div>
        <div className="admin-actions">
          <button className="primary-button" onClick={() => onRename(name)}>
            Lưu tên folder
          </button>
          <button className="delete-button" onClick={onDelete}>
            Xóa folder
          </button>
        </div>
      </div>
      <div className="folder-child-grid">
        {folder.children.map((item) => (
          <button
            className="node-card"
            key={item.id}
            onClick={() => onSelect(item)}
          >
            <span className="node-icon">
              {item.icon || (item.type === "folder" ? "◇" : "▤")}
            </span>
            <span className="node-title">{item.name}</span>
            <span className="node-meta">
              {item.type === "folder"
                ? `${item.children.length} mục con`
                : `${item.cards.length} thẻ`}
            </span>
            <span className="node-arrow">→</span>
          </button>
        ))}
        {!folder.children.length && (
          <p className="muted">Folder này chưa có folder/file con.</p>
        )}
      </div>
    </div>
  );
}
function FileEditor({
  file,
  updateTree,
  toast,
  onDelete,
}: {
  file: FileNode;
  updateTree: (tree: Tree) => void;
  toast: (message: string) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description || "");
  const [cards, setCards] = useState(file.cards);
  const save = () => {
    const saved = JSON.parse(
      localStorage.getItem("vocab-tree") || JSON.stringify(sampleTree),
    ) as Tree;
    const target = findNode(saved, file.id);
    if (target?.type === "file") {
      target.name = name;
      target.description = description;
      target.cards = cards;
    }
    updateTree(saved);
    toast("Đã lưu nội dung local");
  };
  const add = () =>
    setCards([
      ...cards,
      { id: `card-${Date.now()}`, front: { text: "" }, back: { text: "" } },
    ]);
  const change = (id: string, side: "front" | "back", text: string) =>
    setCards(
      cards.map((card) =>
        card.id === id ? { ...card, [side]: { ...card[side], text } } : card,
      ),
    );
  return (
    <div className="editor">
      <div className="editor-heading">
        <div>
          <span className="file-badge">▤ FILE / {cards.length} THẺ</span>
          <input
            className="title-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="desc-input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="admin-actions">
          <button className="primary-button" onClick={save}>
            Lưu thay đổi
          </button>
          <button className="delete-button" onClick={onDelete}>
            Xóa file
          </button>
        </div>
      </div>
      <div className="card-table-head">
        <span>01 / TỪ GỢI Ý</span>
        <span>02 / ĐỊNH NGHĨA</span>
        <span />
      </div>
      <div className="card-list">
        {cards.map((card, index) => (
          <div className="editor-row" key={card.id}>
            <span className="row-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <input
              value={card.front.text}
              placeholder="Nhập từ gợi ý..."
              onChange={(event) => change(card.id, "front", event.target.value)}
            />
            <AudioButton src={card.front.audio} />
            <input
              value={card.back.text}
              placeholder="Nhập định nghĩa..."
              onChange={(event) => change(card.id, "back", event.target.value)}
            />
            <AudioButton src={card.back.audio} />
            <button
              className="delete-button"
              onClick={() =>
                setCards(cards.filter((item) => item.id !== card.id))
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="add-card" onClick={add}>
        + Thêm thẻ mới
      </button>
      <div className="editor-note">
        Âm thanh có thể gắn sau khi kết nối GitHub Contents API. Bản soạn hiện
        tại được lưu ở local để thử luồng editor.
      </div>
    </div>
  );
}

export default App;
