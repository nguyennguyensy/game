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
type CardSide = "front" | "back";
type PendingAudio = {
  blob: Blob;
  previewUrl: string;
  remoteUrl?: string;
};
type StoredAudio = { key: string; blob: Blob; remoteUrl?: string };
type GitTreeItem = { path: string; type: "blob" | "tree"; size?: number };

const draftTreeKey = "vocablab-tree-draft";
const draftAudioStore = "audio";
const draftAudioDb = "vocablab-draft-audio";

const readDraftTree = (): Tree | null => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(draftTreeKey) || "null");
    return isTree(value) ? value : null;
  } catch {
    return null;
  }
};
const openDraftAudioDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(draftAudioDb, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(draftAudioStore, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
const storeDraftAudio = async (key: string, audio: PendingAudio) => {
  const database = await openDraftAudioDb();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(draftAudioStore, "readwrite").objectStore(draftAudioStore).put({
      key,
      blob: audio.blob,
      remoteUrl: audio.remoteUrl,
    } satisfies StoredAudio);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
};
const removeDraftAudio = async (key: string) => {
  const database = await openDraftAudioDb();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(draftAudioStore, "readwrite").objectStore(draftAudioStore).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
};
const readDraftAudio = async () => {
  const database = await openDraftAudioDb();
  const records = await new Promise<StoredAudio[]>((resolve, reject) => {
    const request = database.transaction(draftAudioStore, "readonly").objectStore(draftAudioStore).getAll();
    request.onsuccess = () => resolve(request.result as StoredAudio[]);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return records;
};
const clearDraftAudio = async () => {
  const database = await openDraftAudioDb();
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(draftAudioStore, "readwrite").objectStore(draftAudioStore).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  database.close();
};

const flatNodes = (node: Node): Node[] => [
  node,
  ...(node.type === "folder" ? node.children.flatMap(flatNodes) : []),
];
const findNode = (tree: Tree, id: string) =>
  flatNodes(tree).find((node) => node.id === id);
const allFiles = (tree: Tree) =>
  flatNodes(tree).filter((node): node is FileNode => node.type === "file");
const allFolders = (tree: Tree) =>
  flatNodes(tree).filter((node): node is FolderNode => node.type === "folder");
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
const updateFile = (
  node: FolderNode,
  id: string,
  update: (file: FileNode) => FileNode,
): FolderNode => ({
  ...node,
  children: node.children.map((item) =>
    item.type === "folder"
      ? updateFile(item, id, update)
      : item.id === id
        ? update(item)
        : item,
  ),
});
const cloneFile = (file: FileNode): FileNode => {
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...file,
    id,
    cards: file.cards.map((card) => ({
      ...card,
      id: `${id}-${Math.random().toString(36).slice(2, 8)}`,
      front: { ...card.front },
      back: { ...card.back },
    })),
  };
};
const isTree = (value: unknown): value is Tree => {
  if (!value || typeof value !== "object") return false;
  const tree = value as Partial<Tree>;
  return tree.type === "folder" && typeof tree.id === "string" && Array.isArray(tree.children);
};
const fetchTree = async (
  url: string,
  signal?: AbortSignal,
): Promise<Tree | null> => {
  try {
    const response = await fetch(url, {
      // Ask GitHub to revalidate rather than serving a stale browser response.
      cache: "no-cache",
      signal,
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isTree(data) ? data : null;
  } catch {
    return null;
  }
};
const loadPublishedTree = async (signal?: AbortSignal): Promise<Tree | null> => {
  const githubUrl = `https://raw.githubusercontent.com/${githubConfig.owner}/${githubConfig.repo}/${githubConfig.branch}/${githubConfig.treePath}?v=${Date.now()}`;
  return fetchTree(githubUrl, signal);
};

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
});
const toBase64 = async (blob: Blob) => {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < buffer.length; index += chunkSize) {
    binary += String.fromCharCode(...buffer.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};
const audioPathFromValue = (value?: string) => {
  if (!value) return null;
  if (value.startsWith("public/audio/")) return value;
  if (value.startsWith("/audio/")) return `public${value}`;
  try {
    const url = new URL(value);
    const marker = "/public/audio/";
    const index = url.pathname.indexOf(marker);
    return index >= 0 ? url.pathname.slice(index + 1) : null;
  } catch {
    return null;
  }
};
const referencedAudioPaths = (tree: Tree) =>
  new Set(
    allFiles(tree).flatMap((file) =>
      file.cards.flatMap((card) =>
        [card.front.audio, card.back.audio]
          .map(audioPathFromValue)
          .filter((path): path is string => Boolean(path)),
      ),
    ),
  );
const setCardAudio = (
  tree: Tree,
  fileId: string,
  cardId: string,
  side: CardSide,
  audio: string,
) =>
  updateFile(tree, fileId, (file) => ({
    ...file,
    cards: file.cards.map((card) =>
      card.id === cardId ? { ...card, [side]: { ...card[side], audio } } : card,
    ),
  }));
const hasCard = (tree: Tree, fileId: string, cardId: string) =>
  allFiles(tree).some(
    (file) => file.id === fileId && file.cards.some((card) => card.id === cardId),
  );

function App() {
  const [tree, setTree] = useState<Tree | null>(null);
  const [loadError, setLoadError] = useState(false);
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
    const controller = new AbortController();
    loadPublishedTree(controller.signal).then((publishedTree) => {
      if (controller.signal.aborted) return;
      if (publishedTree) setTree(publishedTree);
      else setLoadError(true);
    });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 2600);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  if (!tree)
    return (
      <LoadingScreen
        failed={loadError}
      />
    );
  if (route.startsWith("/admin"))
    return <Admin tree={tree} toast={setToast} onPublishedTree={setTree} />;
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

function LoadingScreen({
  failed,
}: {
  failed: boolean;
}) {
  return (
    <main className="loading-screen" aria-live="polite">
      <div className="loading-brand">
        <span className="brand-mark">v</span>
        <span>
          vocab<span className="accent">lab</span>
        </span>
      </div>
      {failed ? (
        <div className="load-message">
          <h1>Chưa thể tải nội dung</h1>
          <p>Kiểm tra kết nối mạng rồi tải lại trang.</p>
        </div>
      ) : (
        <div className="load-message">
          <span className="loading-spinner" aria-hidden="true" />
          <p>Đang tải bộ từ của bạn…</p>
        </div>
      )}
    </main>
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
    <button
      type="button"
      className={`audio-button ${src ? "" : "muted-audio"}`}
      onClick={(event) => {
        event.stopPropagation();
        if (src) new Audio(src).play().catch(() => {});
      }}
      disabled={!src}
      aria-label={src ? "Nghe âm thanh" : "Chưa có âm thanh"}
    >
      ◖
    </button>
  );
}
function Learn({ file }: { file: FileNode }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [initialSide, setInitialSide] = useState<"front" | "back">("front");
  const [cards, setCards] = useState(file.cards);
  const card = cards[index];
  const showBack = initialSide === "back" ? !flipped : flipped;
  useEffect(() => {
    // Audio is intentionally fetched only after entering Learn, never while tree.json loads.
    const upcoming = [card, cards[(index + 1) % cards.length]];
    upcoming.forEach((item) => {
      [item?.front.audio, item?.back.audio].forEach((src) => {
        if (src) {
          const audio = new Audio();
          audio.preload = "metadata";
          audio.src = src;
        }
      });
    });
  }, [card, cards, index]);
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
      <div className="card-side-picker" aria-label="Chọn mặt flashcard bắt đầu">
        <span>MẶT BẮT ĐẦU</span>
        <button
          className={initialSide === "front" ? "selected" : ""}
          onClick={() => {
            setInitialSide("front");
            setFlipped(false);
          }}
        >
          Gợi ý
        </button>
        <button
          className={initialSide === "back" ? "selected" : ""}
          onClick={() => {
            setInitialSide("back");
            setFlipped(false);
          }}
        >
          Đáp án
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
        className={`flashcard ${showBack ? "is-flipped" : ""}`}
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
  type GameResult = "won" | "lost";
  const [active, setActive] = useState<Falling[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deck, setDeck] = useState<Card[]>(() =>
    shuffled([...file.cards, ...file.cards, ...file.cards]),
  );
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const INITIAL_LIVES = Math.max(1, Math.floor((file.cards.length * 3) / 10));
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [result, setResult] = useState<GameResult | null>(null);
  const [completed, setCompleted] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [runId, setRunId] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasSpawnedRef = useRef(false);
  const resultRef = useRef<GameResult | null>(null);
  const completedRef = useRef(0);
  const missedLivesRef = useRef(0);
  const missedBoxIdsRef = useRef(new Set<string>());
  const FALL_SPEED = 0.44;
  const SPAWN_INTERVAL_MS = 3500;
  const totalCards = file.cards.length * 3;
  const done = result !== null;
  const won = result === "won";
  const speed = FALL_SPEED + Math.floor(combo / 5) * 0.07;
  const finish = (nextResult: GameResult) => {
    if (resultRef.current) return;
    resultRef.current = nextResult;
    setResult(nextResult);
  };
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
            const newFallen = fallen.filter(
              (item) => !missedBoxIdsRef.current.has(item.id),
            );
            newFallen.forEach((item) => missedBoxIdsRef.current.add(item.id));
            const fallenCount = newFallen.length;
            if (!fallenCount) return moved.filter((item) => item.progress < 100);
            const missedLives = Math.min(
              INITIAL_LIVES,
              missedLivesRef.current + fallenCount,
            );
            missedLivesRef.current = missedLives;
            const nextLives = INITIAL_LIVES - missedLives;
            setLives(nextLives);
            if (missedLives >= INITIAL_LIVES) finish("lost");
            setCombo(0);
          }
          return moved.filter((item) => item.progress < 100);
        }),
      120,
    );
    return () => clearInterval(timer);
  }, [INITIAL_LIVES, done, speed]);
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
          x: 24 + Math.random() * 52,
          progress: -4,
          typed: 0,
          born: now,
        },
      ]);
      hasSpawnedRef.current = true;
    }, hasSpawnedRef.current ? SPAWN_INTERVAL_MS : 0);
    return () => window.clearTimeout(spawnTimer);
  }, [deck, done, runId]);
  useEffect(() => {
    if (
      !done &&
      !deck.length &&
      !active.length &&
      missedLivesRef.current < INITIAL_LIVES
    ) {
      finish("won");
    }
  }, [INITIAL_LIVES, active.length, deck.length, done]);
  const current = active.find((item) => item.id === activeId) ?? active[0];
  const focusInput = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
  };
  const keyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (done || !current || event.key.length !== 1) return;
    event.preventDefault();
    let typed = current.typed;
    while (typed < current.back.text.length && /\s/.test(current.back.text[typed]))
      typed += 1;
    const expected = current.back.text[typed];
    if (event.key.toLowerCase() === expected.toLowerCase()) {
      typed += 1;
      while (typed < current.back.text.length && /\s/.test(current.back.text[typed]))
        typed += 1;
      const updated = { ...current, typed };
      if (updated.typed === updated.back.text.length) {
        setScore((v) => v + 100 + combo * 15);
        setCombo((v) => v + 1);
        const nextCompleted = completedRef.current + 1;
        completedRef.current = nextCompleted;
        setCompleted(nextCompleted);
        if (nextCompleted >= totalCards) finish("won");
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
      const scrollY = window.scrollY;
      setWrong(true);
      window.requestAnimationFrame(() => window.scrollTo(0, scrollY));
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
    missedLivesRef.current = 0;
    missedBoxIdsRef.current.clear();
    completedRef.current = 0;
    resultRef.current = null;
    setLives(INITIAL_LIVES);
    setCompleted(0);
    setResult(null);
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
        onClick={focusInput}
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
              focusInput();
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
        <input ref={inputRef} aria-label="Gõ đáp án" onKeyDown={keyDown} />
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
          <p className="eyebrow">{won ? "HOÀN THÀNH" : "GAME OVER"}</p>
          <p className="result-set-name">{file.name}</p>
          <h2>{won ? "Bạn đã phá tan cơn mưa từ." : "Lần sau sẽ nhanh hơn."}</h2>
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
  tree: publishedTree,
  toast,
  onPublishedTree,
}: {
  tree: Tree;
  toast: (message: string) => void;
  onPublishedTree: (tree: Tree) => void;
}) {
  const [tree, setTree] = useState<Tree>(() => readDraftTree() || publishedTree);
  const updateTree = (next: Tree) => {
    setTree(next);
    try {
      localStorage.setItem(draftTreeKey, JSON.stringify(next));
    } catch {
      toast("Không thể lưu bản nháp trên thiết bị");
      return;
    }
    toast("Đã lưu bản nháp trên thiết bị");
  };
  const [selected, setSelected] = useState<Node>(tree);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState(sessionStorage.getItem("vocab-pat") || "");
  const [copySource, setCopySource] = useState<FileNode | null>(null);
  const [githubError, setGithubError] = useState("");
  const [checkingGithub, setCheckingGithub] = useState(false);
  const pendingAudio = useRef(new Map<string, PendingAudio>());
  const [cleanupCandidates, setCleanupCandidates] = useState<GitTreeItem[] | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [tokenAction, setTokenAction] = useState<"save" | "scan">("save");
  const [, refreshPendingAudio] = useState(0);
  const pendingKey = (fileId: string, cardId: string, side: CardSide) =>
    `${fileId}:${cardId}:${side}`;
  const pendingAudioFor = (fileId: string, cardId: string, side: CardSide) =>
    pendingAudio.current.get(pendingKey(fileId, cardId, side));
  useEffect(() => {
    let active = true;
    const pendingAtMount = pendingAudio.current;
    readDraftAudio()
      .then((records) => {
        if (!active) return;
        records.forEach((record) => {
          pendingAudio.current.set(record.key, {
            blob: record.blob,
            previewUrl: URL.createObjectURL(record.blob),
            remoteUrl: record.remoteUrl,
          });
        });
        refreshPendingAudio((version) => version + 1);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      pendingAtMount.forEach((audio) => URL.revokeObjectURL(audio.previewUrl));
    };
  }, []);
  const changePendingAudio = (
    fileId: string,
    cardId: string,
    side: CardSide,
    audio?: PendingAudio,
  ) => {
    const key = pendingKey(fileId, cardId, side);
    const previous = pendingAudio.current.get(key);
    if (previous?.previewUrl !== audio?.previewUrl) URL.revokeObjectURL(previous?.previewUrl || "");
    if (audio) pendingAudio.current.set(key, audio);
    else pendingAudio.current.delete(key);
    if (audio) void storeDraftAudio(key, audio).catch(() => undefined);
    else void removeDraftAudio(key).catch(() => undefined);
  };
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
    const cleanToken = token.trim();
    setGithubError("");
    if (!cleanToken) {
      setTokenOpen(true);
      setGithubError("Hãy nhập PAT.");
      return;
    }
    setCheckingGithub(true);
    let treeToPublish = tree;
    const headers = {
      Authorization: `Bearer ${cleanToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };
    try {
      const identity = await fetch("https://api.github.com/user", { headers });
      if (!identity.ok) {
        setTokenOpen(true);
        setGithubError(
          identity.status === 401
            ? "PAT không đúng hoặc đã hết hạn."
            : "Không thể xác thực PAT với GitHub.",
        );
        return;
      }
      for (const key of pendingAudio.current.keys()) {
        const [fileId, cardId] = key.split(":");
        if (!hasCard(tree, fileId, cardId)) {
          throw Error("Hãy bấm “Lưu thay đổi” cho bộ từ trước khi lưu audio mới.");
        }
      }
      const refResponse = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/ref/heads/${githubConfig.branch}`,
        { headers },
      );
      const ref = await refResponse.json();
      if (!refResponse.ok || !ref.object?.sha) {
        throw Error(ref.message || "Không đọc được nhánh GitHub");
      }
      const commitResponse = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/commits/${ref.object.sha}`,
        { headers },
      );
      const commit = await commitResponse.json();
      if (!commitResponse.ok || !commit.tree?.sha) {
        throw Error(commit.message || "Không đọc được Git tree hiện tại");
      }
      const treeEntries: Array<{
        path: string;
        mode: "100644";
        type: "blob";
        sha: string;
      }> = [];
      for (const [key, pending] of pendingAudio.current) {
        const [fileId, cardId, side] = key.split(":") as [string, string, CardSide];
        let remoteUrl = pending.remoteUrl;
        if (!remoteUrl) {
          const extension = pending.blob.type.includes("ogg")
            ? "ogg"
            : pending.blob.type.includes("mp4")
              ? "m4a"
              : pending.blob.type.includes("mpeg")
                ? "mp3"
                : pending.blob.type.includes("wav")
                  ? "wav"
                  : "webm";
          const filename = `${side}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
          const path = `public/audio/${fileId}/${cardId}/${filename}`;
          const blobResponse = await fetch(
            `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/blobs`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                content: await toBase64(pending.blob),
                encoding: "base64",
              }),
            },
          );
          const blob = await blobResponse.json().catch(() => null);
          if (!blobResponse.ok || !blob?.sha) {
            throw Error(blob?.message || `Không thể tải audio ${filename}`);
          }
          remoteUrl = `https://raw.githubusercontent.com/${githubConfig.owner}/${githubConfig.repo}/${githubConfig.branch}/${path}`;
          treeEntries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
          pendingAudio.current.set(key, { ...pending, remoteUrl });
        }
        treeToPublish = setCardAudio(treeToPublish, fileId, cardId, side, remoteUrl);
      }
      const treeBlobResponse = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/blobs`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            content: btoa(
              unescape(encodeURIComponent(JSON.stringify(treeToPublish, null, 2))),
            ),
            encoding: "base64",
          }),
        },
      );
      const treeBlob = await treeBlobResponse.json().catch(() => null);
      if (!treeBlobResponse.ok || !treeBlob?.sha) {
        throw Error(treeBlob?.message || "Không tạo được blob tree.json");
      }
      treeEntries.push({ path: githubConfig.treePath, mode: "100644", type: "blob", sha: treeBlob.sha });
      const nextTreeResponse = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/trees`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ base_tree: commit.tree.sha, tree: treeEntries }),
        },
      );
      const nextTree = await nextTreeResponse.json().catch(() => null);
      if (!nextTreeResponse.ok || !nextTree?.sha) {
        throw Error(nextTree?.message || "Không tạo được Git tree mới");
      }
      const result = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/commits`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            message: pendingAudio.current.size
              ? `Update vocabulary tree and ${pendingAudio.current.size} audio file(s)`
              : "Update vocabulary tree",
            tree: nextTree.sha,
            parents: [ref.object.sha],
          }),
        },
      );
      const nextCommit = await result.json().catch(() => null);
      if (!result.ok || !nextCommit?.sha) {
        throw Error(nextCommit?.message || "Không tạo được commit GitHub");
      }
      const updateRef = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/refs/heads/${githubConfig.branch}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ sha: nextCommit.sha, force: false }),
        },
      );
      if (!updateRef.ok) {
        const error = await updateRef.json().catch(() => null);
        throw Error(error?.message || "Nhánh đã thay đổi; hãy lưu lại lần nữa.");
      }
      sessionStorage.setItem("vocab-pat", cleanToken);
      pendingAudio.current.forEach((pending) => URL.revokeObjectURL(pending.previewUrl));
      pendingAudio.current.clear();
      updateTree(treeToPublish);
      localStorage.removeItem(draftTreeKey);
      void clearDraftAudio().catch(() => undefined);
      onPublishedTree(treeToPublish);
      setTokenOpen(false);
      toast("Đã commit lên GitHub. Pages sẽ cập nhật sau ít phút.");
    } catch (error) {
      setTokenOpen(true);
      setGithubError(
        error instanceof Error
          ? error.message
          : "Không thể lưu GitHub. Kiểm tra PAT và quyền contents: write.",
      );
      toast(
        error instanceof Error
          ? `Không thể lưu GitHub: ${error.message}`
          : "Không thể lưu GitHub. Kiểm tra PAT và quyền contents: write.",
      );
    } finally {
      setCheckingGithub(false);
    }
  };
  const scanAudio = async () => {
    const cleanToken = token.trim();
    if (!cleanToken) {
      setTokenAction("scan");
      setTokenOpen(true);
      setGithubError("Hãy nhập PAT có quyền contents: write để quét audio.");
      return;
    }
    setCleanupBusy(true);
    setGithubError("");
    try {
      const response = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/trees/${githubConfig.branch}?recursive=1`,
        { headers: githubHeaders(cleanToken) },
      );
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.tree) || data.truncated) {
        throw Error(data.message || "Không thể đọc danh sách audio trên GitHub");
      }
      const used = referencedAudioPaths(tree);
      const orphaned = (data.tree as GitTreeItem[]).filter(
        (item) => item.type === "blob" && item.path.startsWith("public/audio/") && !used.has(item.path),
      );
      sessionStorage.setItem("vocab-pat", cleanToken);
      setCleanupCandidates(orphaned);
      if (!orphaned.length) toast("Audio đã sạch: không có file thừa.");
    } catch (error) {
      setGithubError(error instanceof Error ? error.message : "Không thể quét audio.");
      setTokenAction("scan");
      setTokenOpen(true);
    } finally {
      setCleanupBusy(false);
    }
  };
  const deleteOrphanAudio = async () => {
    const cleanToken = token.trim();
    if (!cleanToken || !cleanupCandidates?.length) return;
    setCleanupBusy(true);
    try {
      const headers = githubHeaders(cleanToken);
      const refResponse = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/ref/heads/${githubConfig.branch}`,
        { headers },
      );
      const ref = await refResponse.json();
      if (!refResponse.ok || !ref.object?.sha) throw Error(ref.message || "Không đọc được nhánh GitHub");
      const commitResponse = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/commits/${ref.object.sha}`,
        { headers },
      );
      const commit = await commitResponse.json();
      if (!commitResponse.ok || !commit.tree?.sha) throw Error(commit.message || "Không đọc được Git tree");
      const treeResponse = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/trees`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            base_tree: commit.tree.sha,
            tree: cleanupCandidates.map((item) => ({ path: item.path, mode: "100644", type: "blob", sha: null })),
          }),
        },
      );
      const nextTree = await treeResponse.json();
      if (!treeResponse.ok || !nextTree.sha) throw Error(nextTree.message || "Không tạo được thay đổi dọn dẹp");
      const nextCommitResponse = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/commits`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            message: `Clean ${cleanupCandidates.length} orphan audio file(s)`,
            tree: nextTree.sha,
            parents: [ref.object.sha],
          }),
        },
      );
      const nextCommit = await nextCommitResponse.json();
      if (!nextCommitResponse.ok || !nextCommit.sha) throw Error(nextCommit.message || "Không tạo được commit dọn dẹp");
      const updateRef = await fetch(
        `https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/git/refs/heads/${githubConfig.branch}`,
        { method: "PATCH", headers, body: JSON.stringify({ sha: nextCommit.sha, force: false }) },
      );
      if (!updateRef.ok) {
        const error = await updateRef.json().catch(() => null);
        throw Error(error?.message || "Nhánh đã thay đổi; hãy quét lại trước khi xóa.");
      }
      toast(`Đã xóa ${cleanupCandidates.length} file audio không còn được dùng.`);
      setCleanupCandidates(null);
    } catch (error) {
      toast(error instanceof Error ? `Không thể dọn audio: ${error.message}` : "Không thể dọn audio.");
    } finally {
      setCleanupBusy(false);
    }
  };
  const copyFile = (destinationId: string) => {
    if (!copySource) return;
    const copied = cloneFile(copySource);
    updateTree(addChild(tree, destinationId, copied));
    setSelected(copied);
    setCopySource(null);
    toast(`Đã copy "${copied.name}" vào folder đã chọn`);
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
            <button className="outline-button" onClick={scanAudio} disabled={cleanupBusy}>
              {cleanupBusy ? "Đang quét..." : "♲ Dọn audio"}
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
            tree={tree}
            updateTree={updateTree}
            toast={toast}
            onPendingAudio={changePendingAudio}
            pendingAudioFor={pendingAudioFor}
            onDelete={() => deleteNode(selected)}
            onCopy={() => setCopySource(selected)}
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
                onChange={(event) => {
                  setToken(event.target.value);
                  setGithubError("");
                }}
                placeholder="github_pat_..."
              />
              {githubError && <p className="github-error">{githubError}</p>}
              <button
                className="primary-button"
                onClick={tokenAction === "scan" ? scanAudio : saveGithub}
                disabled={checkingGithub}
              >
                {checkingGithub || cleanupBusy
                  ? "Đang kiểm tra..."
                  : tokenAction === "scan"
                    ? "Xác nhận & quét"
                    : "Xác nhận & lưu"}
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
        {copySource && (
          <div className="edit-modal">
            <div className="modal-card">
              <p className="eyebrow">COPY FILE</p>
              <h2>Chọn folder đích</h2>
              <p className="muted">
                File giữ nguyên tên, kể cả khi folder đích đã có file cùng tên.
              </p>
              <div className="copy-folder-list">
                {allFolders(tree).map((folder) => (
                  <button
                    key={folder.id}
                    className="outline-button"
                    onClick={() => copyFile(folder.id)}
                  >
                    ◇ {folder.name}
                  </button>
                ))}
              </div>
              <button className="text-button" onClick={() => setCopySource(null)}>
                Hủy
              </button>
            </div>
          </div>
        )}
        {cleanupCandidates && (
          <div className="edit-modal">
            <div className="modal-card cleanup-modal">
              <p className="eyebrow">AUDIO CLEANUP</p>
              <h2>{cleanupCandidates.length ? "Xóa audio không còn dùng?" : "Audio đã sạch"}</h2>
              {cleanupCandidates.length ? (
                <>
                  <p className="muted">
                    {cleanupCandidates.length} file dưới <code>public/audio/</code> không được card nào trong tree hiện tại tham chiếu.
                  </p>
                  <ul className="cleanup-list">
                    {cleanupCandidates.slice(0, 10).map((item) => <li key={item.path}>{item.path}</li>)}
                  </ul>
                  {cleanupCandidates.length > 10 && <p className="muted">và {cleanupCandidates.length - 10} file khác.</p>}
                  <button className="delete-button cleanup-confirm" onClick={deleteOrphanAudio} disabled={cleanupBusy}>
                    {cleanupBusy ? "Đang xóa..." : `Xóa ${cleanupCandidates.length} file`}
                  </button>
                </>
              ) : (
                <p className="muted">Không có file audio nào cần dọn.</p>
              )}
              <button className="text-button" onClick={() => setCleanupCandidates(null)}>Đóng</button>
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

function AudioEditor({
  src,
  previewSrc,
  onRecord,
  onRemove,
  toast,
}: {
  src?: string;
  previewSrc?: string;
  onRecord: (audio: PendingAudio) => void;
  onRemove: () => void;
  toast: (message: string) => void;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(
    () => () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast("Trình duyệt này không hỗ trợ ghi âm");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        onRecord({ blob, previewUrl: URL.createObjectURL(blob) });
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast("Không thể truy cập microphone");
    }
  };

  const stopRecording = () => recorderRef.current?.stop();

  const upload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast("Hãy chọn một file audio");
      return;
    }
    onRecord({ blob: file, previewUrl: URL.createObjectURL(file) });
    event.target.value = "";
  };

  return (
    <div className="audio-editor">
      <AudioButton src={previewSrc || src} />
      <button
        type="button"
        className="audio-action"
        onClick={recording ? stopRecording : startRecording}
      >
        {recording ? "Dừng" : "Ghi mic"}
      </button>
      <button
        type="button"
        className="audio-action"
        onClick={() => uploadRef.current?.click()}
      >
        Tải lên
      </button>
      {(src || previewSrc) && (
        <button
          type="button"
          className="audio-remove"
          onClick={onRemove}
          aria-label="Xóa âm thanh"
        >
          ×
        </button>
      )}
      <input
        ref={uploadRef}
        className="audio-upload"
        type="file"
        accept="audio/*"
        onChange={upload}
      />
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
  tree,
  updateTree,
  toast,
  onPendingAudio,
  pendingAudioFor,
  onDelete,
  onCopy,
}: {
  file: FileNode;
  tree: Tree;
  updateTree: (tree: Tree) => void;
  toast: (message: string) => void;
  onPendingAudio: (fileId: string, cardId: string, side: CardSide, audio?: PendingAudio) => void;
  pendingAudioFor: (fileId: string, cardId: string, side: CardSide) => PendingAudio | undefined;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description || "");
  const [cards, setCards] = useState(file.cards);
  const save = () => {
    updateTree(
      updateFile(tree, file.id, (currentFile) => ({
        ...currentFile,
        name,
        description,
        cards,
      })),
    );
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
  const changeAudio = (
    id: string,
    side: "front" | "back",
    audio?: string,
  ) =>
    setCards(
      cards.map((card) =>
        card.id === id
          ? { ...card, [side]: { ...card[side], audio } }
          : card,
      ),
    );
  const stageAudio = (cardId: string, side: CardSide, audio?: PendingAudio) => {
    onPendingAudio(file.id, cardId, side, audio);
  };
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
          <button className="outline-button" onClick={onCopy}>
            ⧉ Copy file
          </button>
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
            <AudioEditor
              src={card.front.audio}
              toast={toast}
              previewSrc={pendingAudioFor(file.id, card.id, "front")?.previewUrl}
              onRecord={(audio) => stageAudio(card.id, "front", audio)}
              onRemove={() => {
                stageAudio(card.id, "front");
                changeAudio(card.id, "front", undefined);
              }}
            />
            <input
              value={card.back.text}
              placeholder="Nhập định nghĩa..."
              onChange={(event) => change(card.id, "back", event.target.value)}
            />
            <AudioEditor
              src={card.back.audio}
              toast={toast}
              previewSrc={pendingAudioFor(file.id, card.id, "back")?.previewUrl}
              onRecord={(audio) => stageAudio(card.id, "back", audio)}
              onRemove={() => {
                stageAudio(card.id, "back");
                changeAudio(card.id, "back", undefined);
              }}
            />
            <button
              className="delete-button"
              onClick={() => {
                stageAudio(card.id, "front");
                stageAudio(card.id, "back");
                setCards(cards.filter((item) => item.id !== card.id));
              }}
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
        Audio mới chỉ là bản xem trước cho đến khi bạn bấm “Lưu GitHub”. File
        được lưu riêng tại <code>public/audio/fileId/cardId/</code>; tree chỉ giữ URL.
      </div>
    </div>
  );
}

export default App;
