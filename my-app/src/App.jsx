import { supabase } from './supabaseClient';
import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────
// Built-in sample games
// ─────────────────────────────────────────────
const SAMPLE_GAMES = [
  {
    id: "snake",
    name: "Snake",
    description: "Navigate the snake to eat food and grow longer without hitting walls or yourself.",
    category: "Arcade",
    difficulty: "Medium",
    instructions: "Use arrow keys or WASD to move. Eat the red food to score. Don't hit the walls or your own tail!",
    thumbnail: "🐍",
    color: "#1D9E75",
    scoreType: "highscore",
    version: "1.0",
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
    plays: 0,
    type: "builtin",
  },
  {
    id: "memory",
    name: "Memory Match",
    description: "Flip cards and find matching pairs. Test and train your memory!",
    category: "Puzzle",
    difficulty: "Easy",
    instructions: "Click a card to flip it, then click another. Match all pairs to win! Fewer moves = higher score.",
    thumbnail: "🃏",
    color: "#534AB7",
    scoreType: "highscore",
    version: "1.0",
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    plays: 0,
    type: "builtin",
  },
];

// ─────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────
const T = {
  bg: "#0f0f13",
  surface: "#17171e",
  card: "#1e1e28",
  border: "#2a2a38",
  accent: "#7c5cbf",
  accentLight: "#a07de0",
  text: "#f0eeff",
  muted: "#8888aa",
  danger: "#e24b4a",
  success: "#1D9E75",
  warning: "#EF9F27",
};

// ─────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────
function formatDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function timeAgo(iso) {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ─────────────────────────────────────────────
// Score SDK (global, usable by games)
// ─────────────────────────────────────────────
function createScoreSDK(db, setDb, playerName, checkAchievements) {
  return {
    submitScore: async (gameId, score) => {
      // Upsert player
      const playerId = `p_${playerName.toLowerCase().replace(/\s+/g, '_')}`;
      await supabase.from('players').upsert({ id: playerId, name: playerName }, { onConflict: 'name' });

      // Insert score
      const entry = {
        id: `s_${Date.now()}`,
        player_id: playerId,
        player_name: playerName,
        game_id: gameId,
        score,
      };
      await supabase.from('scores').insert(entry);

      // Update local state
      setDb(prev => ({
        ...prev,
        players: prev.players.find(p => p.name === playerName)
          ? prev.players
          : [...prev.players, { id: playerId, name: playerName, created_at: new Date().toISOString() }],
        scores: [...prev.scores, { ...entry, created_at: new Date().toISOString() }],
      }));

      checkAchievements(db, playerId, gameId, score);
    },
  };
}

// ─────────────────────────────────────────────
// Snake Game Component
// ─────────────────────────────────────────────
function SnakeGame({ onScore, onClose }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const animRef = useRef(null);
  const [score, setScore] = useState(0);
  const [status, setStatus] = useState("idle"); // idle | playing | dead

  const CELL = 20;
  const COLS = 20;
  const ROWS = 20;

  const initState = () => ({
    snake: [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }],
    dir: { x: 1, y: 0 },
    nextDir: { x: 1, y: 0 },
    food: { x: 15, y: 10 },
    score: 0,
    alive: true,
    speed: 150,
    lastTime: 0,
  });

  const placeFood = (snake) => {
    while (true) {
      const pos = {
        x: Math.floor(Math.random() * COLS),
        y: Math.floor(Math.random() * ROWS),
      };

      const occupied = snake.some(
        segment => segment.x === pos.x && segment.y === pos.y
      );

      if (!occupied) return pos;
    }
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !stateRef.current) return;
    const ctx = canvas.getContext("2d");
    const s = stateRef.current;

    ctx.fillStyle = "#0f0f13";
    ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

    // Grid
    ctx.strokeStyle = "#1e1e28";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= COLS; i++) {
      ctx.beginPath(); ctx.moveTo(i * CELL, 0); ctx.lineTo(i * CELL, ROWS * CELL); ctx.stroke();
    }
    for (let j = 0; j <= ROWS; j++) {
      ctx.beginPath(); ctx.moveTo(0, j * CELL); ctx.lineTo(COLS * CELL, j * CELL); ctx.stroke();
    }

    // Food
    ctx.fillStyle = "#e24b4a";
    ctx.beginPath();
    ctx.arc(s.food.x * CELL + CELL / 2, s.food.y * CELL + CELL / 2, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();

    // Snake
    s.snake.forEach((seg, i) => {
      const alpha = 1 - (i / s.snake.length) * 0.4;
      ctx.fillStyle = i === 0 ? "#a07de0" : `rgba(124,92,191,${alpha})`;
      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }, []);

  const gameLoop = useCallback((timestamp) => {
    const s = stateRef.current;
    if (!s || !s.alive) return;

    if (timestamp - s.lastTime >= s.speed) {
      s.dir = s.nextDir;
      const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };

      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || s.snake.some(seg => seg.x === head.x && seg.y === head.y)) {
        s.alive = false;
        setStatus("dead");
        onScore(s.score);
        draw();
        return;
      }

      s.snake = [head, ...s.snake];
      if (head.x === s.food.x && head.y === s.food.y) {
        s.score += 10;
        s.food = placeFood(s.snake);
        s.speed = Math.max(80, s.speed - 1);
        setScore(s.score);
      } else {
        s.snake.pop();
      }
      s.lastTime = timestamp;
      draw();
    }
    animRef.current = requestAnimationFrame(gameLoop);
  }, [draw, onScore]);

  const startGame = () => {
    stateRef.current = initState();
    setScore(0);
    setStatus("playing");
    draw();
    animRef.current = requestAnimationFrame(gameLoop);
  };

  useEffect(() => {
    const handleKey = (e) => {
      const s = stateRef.current;
      if (!s || !s.alive) return;
      const map = {
        ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
      };
      const newDir = map[e.key];
      if (newDir && !(newDir.x === -s.dir.x && newDir.y === -s.dir.y)) {
        s.nextDir = newDir;
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  useEffect(() => {
    draw();
  }, [draw]);

  const [touch, setTouch] = useState(null);
  const handleTouchStart = (e) => setTouch({ x: e.touches[0].clientX, y: e.touches[0].clientY });
  const handleTouchEnd = (e) => {
    if (!touch || !stateRef.current?.alive) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    const s = stateRef.current;
    if (Math.abs(dx) > Math.abs(dy)) {
      const nd = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
      if (!(nd.x === -s.dir.x)) s.nextDir = nd;
    } else {
      const nd = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
      if (!(nd.y === -s.dir.y)) s.nextDir = nd;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 400 }}>
        <span style={{ color: T.muted, fontSize: 14 }}>Score: <strong style={{ color: T.text }}>{score}</strong></span>
        <button onClick={onClose} style={btnStyle("secondary")}>✕ Exit</button>
      </div>
      <canvas
        ref={canvasRef}
        width={COLS * CELL}
        height={ROWS * CELL}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ border: `2px solid ${T.border}`, borderRadius: 8, cursor: "none", maxWidth: "100%", touchAction: "none" }}
      />
      {status === "idle" && (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: T.muted, fontSize: 13, marginBottom: 12 }}>Use arrow keys / WASD to move</p>
          <button onClick={startGame} style={btnStyle("primary")}>▶ Start Game</button>
        </div>
      )}
      {status === "dead" && (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: T.danger, fontWeight: 600, marginBottom: 4 }}>Game Over!</p>
          <p style={{ color: T.muted, fontSize: 13, marginBottom: 12 }}>Final Score: {score}</p>
          <button onClick={startGame} style={btnStyle("primary")}>▶ Play Again</button>
        </div>
      )}
      {/* Mobile controls */}
      <div style={{ display: "grid", gridTemplateColumns: "40px 40px 40px", gap: 4, marginTop: 8 }}>
        {[["↑", 0, { x: 0, y: -1 }], ["↓", 2, { x: 0, y: 1 }], ["←", 3, { x: -1, y: 0 }], ["→", 5, { x: 1, y: 0 }]].map(([label, col, dir]) => (
          <button key={label} style={{ gridColumn: col === 3 ? 1 : col === 5 ? 3 : 2, gridRow: col === 0 ? 1 : col === 2 ? 3 : 2, ...dpadStyle }} onClick={() => { const s = stateRef.current; if (s?.alive) s.nextDir = dir; }}>{label}</button>
        ))}
      </div>
    </div>
  );
}

const dpadStyle = { background: "#2a2a38", border: `1px solid ${T.border}`, borderRadius: 6, color: T.text, fontSize: 18, cursor: "pointer", width: 40, height: 40 };

// ─────────────────────────────────────────────
// Memory Match Game
// ─────────────────────────────────────────────
const EMOJIS = ["🎮", "🚀", "🌟", "🎯", "🔮", "🎨", "🦄", "🎸"];

function MemoryGame({ onScore, onClose }) {
  const [cards, setCards] = useState([]);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [status, setStatus] = useState("idle");
  const [checking, setChecking] = useState(false);

  const initGame = () => {
    const deck = [...EMOJIS, ...EMOJIS]
      .map((e, i) => ({ id: i, emoji: e, matched: false }))
      .sort(() => Math.random() - 0.5);
    setCards(deck);
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setStatus("playing");
  };

  const handleFlip = (idx) => {
    if (checking || flipped.length === 2 || flipped.includes(idx) || matched.includes(cards[idx].emoji)) return;
    const newFlipped = [...flipped, idx];
    setFlipped(newFlipped);

    if (newFlipped.length === 2) {
      setChecking(true);
      setMoves(m => m + 1);
      const [a, b] = newFlipped;
      setTimeout(() => {
        if (cards[a].emoji === cards[b].emoji) {
          const newMatched = [...matched, cards[a].emoji];
          setMatched(newMatched);
          setFlipped([]);
          setChecking(false);
          if (newMatched.length === EMOJIS.length) {
            const score = Math.max(0, 1000 - (moves + 1) * 20);
            setStatus("won");
            onScore(score);
          }
        } else {
          setTimeout(() => { setFlipped([]); setChecking(false); }, 400);
        }
      }, 600);
    }
  };

  const isFlipped = (idx) => flipped.includes(idx) || matched.includes(cards[idx]?.emoji);
  const score = Math.max(0, 1000 - moves * 20);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", width: "100%", maxWidth: 400 }}>
        <span style={{ color: T.muted, fontSize: 14 }}>Moves: <strong style={{ color: T.text }}>{moves}</strong> · Score: <strong style={{ color: T.accentLight }}>{score}</strong></span>
        <button onClick={onClose} style={btnStyle("secondary")}>✕ Exit</button>
      </div>

      {status === "idle" && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🃏</div>
          <p style={{ color: T.muted, marginBottom: 16 }}>Match all pairs with fewest moves for highest score</p>
          <button onClick={initGame} style={btnStyle("primary")}>▶ Start Game</button>
        </div>
      )}

      {status !== "idle" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 72px)", gap: 8 }}>
          {cards.map((card, idx) => (
            <div
              key={idx}
              onClick={() => handleFlip(idx)}
              style={{
                width: 72, height: 72, borderRadius: 10, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 28, transition: "all 0.15s",
                background: isFlipped(idx) ? (matched.includes(card.emoji) ? "#1D9E7522" : "#2a2a38") : T.card,
                border: `2px solid ${isFlipped(idx) ? (matched.includes(card.emoji) ? T.success : T.accent) : T.border}`,
                transform: isFlipped(idx) ? "scale(1.04)" : "scale(1)",
                userSelect: "none",
              }}
            >
              {isFlipped(idx) ? card.emoji : "❓"}
            </div>
          ))}
        </div>
      )}

      {status === "won" && (
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <p style={{ color: T.success, fontWeight: 600, fontSize: 18, marginBottom: 4 }}>You won! 🎉</p>
          <p style={{ color: T.muted, fontSize: 13, marginBottom: 12 }}>Completed in {moves} moves · Score: {score}</p>
          <button onClick={initGame} style={btnStyle("primary")}>▶ Play Again</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Button helpers
// ─────────────────────────────────────────────
function btnStyle(variant) {
  const base = { border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "8px 16px", transition: "all 0.15s" };
  if (variant === "primary") return { ...base, background: T.accent, color: "#fff" };
  if (variant === "danger") return { ...base, background: T.danger, color: "#fff" };
  if (variant === "secondary") return { ...base, background: T.card, color: T.muted, border: `1px solid ${T.border}` };
  if (variant === "ghost") return { ...base, background: "transparent", color: T.muted };
  return base;
}

// ─────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────
export default function GameHub() {

  const [db, setDb] = useState({ games: [], players: [], scores: [], /* keep achievements hardcoded */ });
  const [loading, setLoading] = useState(true);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const ADMIN_PASSWORD = 'gamehub2026'; // change this to whatever you want

  useEffect(() => {
    async function fetchAll() {
      const [{ data: games }, { data: players }, { data: scores }] = await Promise.all([
        supabase.from('games').select('*').order('created_at', { ascending: false }),
        supabase.from('players').select('*'),
        supabase.from('scores').select('*').order('created_at', { ascending: false }),
      ]);
      setDb(prev => ({
        ...prev,
        games: games || [],
        players: players || [],
        scores: scores || [],
      }));
      setLoading(false);
    }
    fetchAll();
  }, []);

  const [view, setView] = useState("home"); // home | game | admin | leaderboard | achievements
  const [selectedGame, setSelectedGame] = useState(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("gamehub_player") || "");
  const [nameInput, setNameInput] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [pendingGame, setPendingGame] = useState(null);
  const [lastScore, setLastScore] = useState(null);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("All");
  const [filterDiff, setFilterDiff] = useState("All");
  const [adminTab, setAdminTab] = useState("overview");
  const [addGameForm, setAddGameForm] = useState({ name: "", description: "", category: "Arcade", difficulty: "Easy", instructions: "", thumbnail: "🎮", color: "#7c5cbf" });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiManifest, setAiManifest] = useState("");

  // Merge built-in games with db
  const allGames = [
    ...SAMPLE_GAMES.map(g => {
      const dbGame = db.games.find(dg => dg.id === g.id);
      return { ...g, plays: dbGame?.plays || g.plays };
    }),
    ...db.games.filter(g => !SAMPLE_GAMES.find(sg => sg.id === g.id)),
  ];

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const checkAchievements = useCallback((newDb, playerId, gameId, score) => {
    const earned = new Set(newDb.player_achievements.filter(pa => pa.playerId === playerId).map(pa => pa.achievementId));
    const toEarn = [];
    const totalPlays = newDb.scores.filter(s => s.playerId === playerId).length;

    if (!earned.has("first_play")) toEarn.push("first_play");
    if (score >= 100 && !earned.has("score_100")) toEarn.push("score_100");
    if (score >= 500 && !earned.has("score_500")) toEarn.push("score_500");
    if (totalPlays >= 5 && !earned.has("play_5")) toEarn.push("play_5");

    // top 10 check
    const leaderboard = newDb.scores.filter(s => s.gameId === gameId).sort((a, b) => b.score - a.score);
    const rank = leaderboard.findIndex(s => s.playerId === playerId && s.score === score);
    if (rank >= 0 && rank < 10 && !earned.has("top_10")) toEarn.push("top_10");

    if (toEarn.length > 0) {
      const updates = toEarn.map(id => ({ playerId, achievementId: id, earnedAt: new Date().toISOString() }));
      supabase.from('player_achievements').insert(updates); // !!!
      toEarn.forEach(id => {
        const ach = newDb.achievements.find(a => a.id === id);
        if (ach) showToast(`🏆 Achievement: ${ach.title}!`, "achievement");
      });
    }
  }, []);

  const scoreSDK = createScoreSDK(db, setDb, playerName, checkAchievements);

  const launchGame = (game) => {
    if (!playerName) {
      setPendingGame(game);
      setShowNamePrompt(true);
    } else {
      setSelectedGame(game);
      setView("playing");
      setLastScore(null);
    }
  };

  const handleSetName = () => {
    const name = nameInput.trim() || "Player";
    setPlayerName(name);
    localStorage.setItem("gamehub_player", name);
    setNameInput("");
    setShowNamePrompt(false);
    if (pendingGame) {
      setSelectedGame(pendingGame);
      setView("playing");
      setLastScore(null);
      setPendingGame(null);
    }
  };

  const handleScore = (score) => {
    scoreSDK.submitScore(selectedGame.id, score);
    setLastScore(score);
    showToast(`Score ${score} submitted!`);
  };

  // AI game manifest generator
  const generateManifest = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `Generate a game manifest JSON for a mini-game called "${addGameForm.name}". 
            Description: ${addGameForm.description}
            Category: ${addGameForm.category}
            Difficulty: ${addGameForm.difficulty}
            Instructions: ${addGameForm.instructions}
            
            Return ONLY valid JSON with fields: id (slug), name, description, category, difficulty, version, scoreType (highscore or time), instructions, suggestedThumbnail (single emoji), suggestedColor (hex color).`
          }],
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "{}";
      const clean = text.replace(/```json|```/g, "").trim();
      setAiManifest(clean);
    } catch (e) {
      setAiManifest("Error generating manifest. Please try again.");
    }
    setAiLoading(false);
  };

  const registerGame = async () => {
    let manifest = {};
    try { manifest = JSON.parse(aiManifest); } catch {}

    const id = manifest.id || addGameForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (allGames.find(g => g.id === id)) { showToast('A game with this ID already exists.', 'error'); return; }

    const newGame = {
      id,
      name: addGameForm.name || manifest.name,
      description: addGameForm.description || manifest.description,
      category: addGameForm.category,
      difficulty: addGameForm.difficulty,
      instructions: addGameForm.instructions || manifest.instructions,
      thumbnail: manifest.suggestedThumbnail || addGameForm.thumbnail,
      color: manifest.suggestedColor || addGameForm.color,
      score_type: manifest.scoreType || 'highscore',
      version: manifest.version || '1.0',
      plays: 0,
      type: 'custom',
      manifest,
    };

    const { error } = await supabase.from('games').insert(newGame);
    if (error) { showToast('Error saving game: ' + error.message, 'error'); return; }

    setDb(prev => ({ ...prev, games: [newGame, ...prev.games] }));
    setAiManifest('');
    setAddGameForm({ name: '', description: '', category: 'Arcade', difficulty: 'Easy', instructions: '', thumbnail: '🎮', color: '#7c5cbf' });
    showToast(`"${newGame.name}" registered successfully!`);
    setAdminTab('games');
  };

  const deleteGame = (id) => {
    if (SAMPLE_GAMES.find(g => g.id === id)) { showToast("Cannot delete built-in games.", "error"); return; }
    const newDb = { ...db, games: db.games.filter(g => g.id !== id) };
    setDb(newDb);
    showToast("Game removed.");
  };

  // Filtered games
  const categories = ["All", ...new Set(allGames.map(g => g.category))];
  const difficulties = ["All", "Easy", "Medium", "Hard"];
  const filteredGames = allGames.filter(g => {
    const q = search.toLowerCase();
    return (!q || g.name.toLowerCase().includes(q) || g.description.toLowerCase().includes(q))
      && (filterCat === "All" || g.category === filterCat)
      && (filterDiff === "All" || g.difficulty === filterDiff);
  });

  // Leaderboard
  const getLeaderboard = (gameId) => {
    const byPlayer = {};
    db.scores.filter(s => s.gameId === gameId).forEach(s => {
      if (!byPlayer[s.playerName] || byPlayer[s.playerName] < s.score) byPlayer[s.playerName] = s.score;
    });
    return Object.entries(byPlayer).map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score).slice(0, 10);
  };

  // Analytics
  const totalPlays = allGames.reduce((acc, g) => acc + (db.scores.filter(s => s.gameId === g.id).length), 0);
  const totalScores = db.scores.length;
  const mostPlayed = [...allGames].sort((a, b) => (db.scores.filter(s => s.gameId === b.id).length) - (db.scores.filter(s => s.gameId === a.id).length));

  // Player achievements
  const playerObj = db.players.find(p => p.name === playerName);
  const myAchievements = playerObj ? db.player_achievements.filter(pa => pa.playerId === playerObj.id) : [];

  // ─── Render ───
  // ─── Render ───
  if (loading) return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: T.muted }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🎮</div>
        <p>Loading GameHub...</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "system-ui, sans-serif" }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999, padding: "12px 20px",
          background: toast.type === "error" ? T.danger : toast.type === "achievement" ? "#EF9F27" : T.success,
          color: "#fff", borderRadius: 10, fontWeight: 600, fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          animation: "slideIn 0.2s ease", maxWidth: 300,
        }}>
          {toast.msg}
        </div>
      )}

      {/* Name Prompt Modal */}
      {showNamePrompt && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: T.card, borderRadius: 16, padding: 32, maxWidth: 360, width: "90%", border: `1px solid ${T.border}` }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Enter Your Name</h2>
            <p style={{ color: T.muted, fontSize: 14, margin: "0 0 20px" }}>Your name will be saved for the leaderboard.</p>
            <input
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSetName()}
              placeholder="Your name..."
              autoFocus
              style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 15, marginBottom: 16, boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleSetName} style={{ ...btnStyle("primary"), flex: 1 }}>Start Playing</button>
              <button onClick={() => { setShowNamePrompt(false); setPendingGame(null); }} style={btnStyle("secondary")}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "12px 24px", display: "flex", alignItems: "center", gap: 16, position: "sticky", top: 0, zIndex: 100 }}>
        <button onClick={() => setView("home")} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 22 }}>🎮</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: T.accentLight, letterSpacing: "-0.5px" }}>GameHub</span>
        </button>
        <div style={{ flex: 1 }} />
        {["home", "leaderboard", "achievements"].map(v => (
          <button key={v} onClick={() => setView(v)} style={{ ...btnStyle("ghost"), color: view === v ? T.accentLight : T.muted, fontWeight: view === v ? 600 : 400, textTransform: "capitalize" }}>
            {v === "home" ? "🏠 Games" : v === "leaderboard" ? "🏆 Ranks" : "⭐ Badges"}
          </button>
        ))}
        <button
          onClick={() => adminUnlocked ? setView('admin') : setView('adminlogin')}
          style={{ ...btnStyle(view === 'admin' ? 'primary' : 'secondary'), fontSize: 12 }}
        >
          ⚙ Admin
        </button>
        {adminUnlocked && (
          <button
            onClick={() => { setAdminUnlocked(false); setView('home'); }}
            style={{ ...btnStyle('ghost'), fontSize: 11, color: T.danger }}
          >
            Lock
          </button>
        )}
        {playerName && (
          <button onClick={() => { setNameInput(playerName); setShowNamePrompt(true); setPendingGame(null); }} style={{ ...btnStyle("ghost"), fontSize: 12, color: T.accent }}>
            👤 {playerName}
          </button>
        )}
      </nav>

      {/* ─── HOME: Game Library ─── */}
      {view === "home" && (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
          <div style={{ marginBottom: 32 }}>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", background: `linear-gradient(135deg, ${T.accentLight}, #e0b0ff)`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Play &amp; Compete
            </h1>
            <p style={{ color: T.muted, margin: 0 }}>{allGames.length} games · {totalPlays} total plays</p>
          </div>

          {/* Search & Filters */}
          <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Search games..."
              style={{ flex: 1, minWidth: 200, padding: "8px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 14 }}
            />
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 14 }}>
              {categories.map(c => <option key={c}>{c}</option>)}
            </select>
            <select value={filterDiff} onChange={e => setFilterDiff(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 14 }}>
              {difficulties.map(d => <option key={d}>{d}</option>)}
            </select>
          </div>

          {/* Game Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 20 }}>
            {filteredGames.map(game => (
              <GameCard key={game.id} game={game} db={db} onPlay={() => launchGame(game)} onDetail={() => { setSelectedGame(game); setView("game"); }} />
            ))}
            {filteredGames.length === 0 && (
              <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 60, color: T.muted }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
                <p>No games found. Try a different search or add new games in Admin.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── GAME DETAIL ─── */}
      {view === "game" && selectedGame && (
        <GameDetail
          game={selectedGame}
          db={db}
          getLeaderboard={getLeaderboard}
          onPlay={() => launchGame(selectedGame)}
          onBack={() => { setSelectedGame(null); setView("home"); }}
          lastScore={lastScore}
        />
      )}

      {/* ─── PLAYING ─── */}
      {view === "playing" && selectedGame && (
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "32px 24px" }}>
          <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 24 }}>{selectedGame.thumbnail}</span>
            <h2 style={{ margin: 0 }}>{selectedGame.name}</h2>
            <span style={{ marginLeft: "auto", color: T.muted, fontSize: 13 }}>Playing as <strong style={{ color: T.accentLight }}>{playerName}</strong></span>
          </div>
          {selectedGame.id === "snake" && <SnakeGame onScore={handleScore} onClose={() => { setView("game"); }} />}
          {selectedGame.id === "memory" && <MemoryGame onScore={handleScore} onClose={() => { setView("game"); }} />}
          {selectedGame.type === "custom" && (
            <div style={{ textAlign: "center", padding: 60, background: T.card, borderRadius: 16, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>{selectedGame.thumbnail}</div>
              <h3 style={{ color: T.text, marginBottom: 8 }}>{selectedGame.name}</h3>
              <p style={{ color: T.muted, marginBottom: 24, maxWidth: 400, margin: "0 auto 24px" }}>{selectedGame.instructions}</p>
              <p style={{ color: T.muted, fontSize: 12, marginBottom: 16 }}>Custom game — upload game files to enable playback.</p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button onClick={() => handleScore(Math.floor(Math.random() * 400) + 100)} style={btnStyle("primary")}>🎲 Simulate Score</button>
                <button onClick={() => { setView("game"); }} style={btnStyle("secondary")}>← Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── LEADERBOARD ─── */}
      {view === "leaderboard" && (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
          <h1 style={{ margin: "0 0 24px", fontSize: 28 }}>🏆 Leaderboards</h1>
          {allGames.map(game => {
            const lb = getLeaderboard(game.id);
            if (lb.length === 0) return null;
            return (
              <div key={game.id} style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: 24, marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <span style={{ fontSize: 28 }}>{game.thumbnail}</span>
                  <h3 style={{ margin: 0 }}>{game.name}</h3>
                  <span style={{ marginLeft: "auto", color: T.muted, fontSize: 13 }}>{lb.length} players</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Rank", "Player", "Best Score"].map(h => <th key={h} style={{ textAlign: h === "Best Score" ? "right" : "left", padding: "6px 0", color: T.muted, fontSize: 12, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {lb.map((entry, i) => (
                      <tr key={i}>
                        <td style={{ padding: "8px 0", width: 50 }}><span style={{ fontWeight: 700, color: i === 0 ? "#EF9F27" : i === 1 ? "#aaa" : i === 2 ? "#cd7f32" : T.muted }}>#{i + 1}</span></td>
                        <td style={{ padding: "8px 0" }}>{entry.name === playerName ? <strong style={{ color: T.accentLight }}>{entry.name} (you)</strong> : entry.name}</td>
                        <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 700, color: T.accentLight }}>{entry.score.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
          {db.scores.length === 0 && <p style={{ color: T.muted, textAlign: "center", padding: 40 }}>No scores yet. Play some games!</p>}
        </div>
      )}

      {/* ─── ACHIEVEMENTS ─── */}
      {view === "achievements" && (
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 28 }}>⭐ Achievements</h1>
          <p style={{ color: T.muted, marginBottom: 28 }}>{playerName ? `Logged in as ${playerName} · ${myAchievements.length}/${db.achievements.length} earned` : "Set your name to track achievements"}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
            {db.achievements.map(ach => {
              const earned = myAchievements.find(pa => pa.achievementId === ach.id);
              return (
                <div key={ach.id} style={{ background: T.card, borderRadius: 12, border: `2px solid ${earned ? T.accent : T.border}`, padding: 20, opacity: earned ? 1 : 0.5 }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>{ach.icon}</div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>{ach.title}</div>
                  <div style={{ color: T.muted, fontSize: 13 }}>{ach.description}</div>
                  {earned && <div style={{ color: T.accent, fontSize: 11, marginTop: 8 }}>✓ Earned {timeAgo(earned.earnedAt)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── ADMIN LOGIN ─── */}
      {view === 'adminlogin' && (
        <div style={{ maxWidth: 380, margin: '80px auto', padding: '0 24px' }}>
          <div style={{ background: T.card, borderRadius: 16, padding: 32, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 16 }}>🔒</div>
            <h2 style={{ margin: '0 0 8px', textAlign: 'center' }}>Admin Access</h2>
            <p style={{ color: T.muted, fontSize: 14, textAlign: 'center', margin: '0 0 24px' }}>
              Enter the admin password to continue.
            </p>
            <input
              type="password"
              value={adminPasswordInput}
              onChange={e => setAdminPasswordInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (adminPasswordInput === ADMIN_PASSWORD) {
                    setAdminUnlocked(true);
                    setView('admin');
                    setAdminPasswordInput('');
                  } else {
                    showToast('Incorrect password.', 'error');
                    setAdminPasswordInput('');
                  }
                }
              }}
              placeholder="Password..."
              autoFocus
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${T.border}`, background: T.surface,
                color: T.text, fontSize: 15, marginBottom: 14, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  if (adminPasswordInput === ADMIN_PASSWORD) {
                    setAdminUnlocked(true);
                    setView('admin');
                    setAdminPasswordInput('');
                  } else {
                    showToast('Incorrect password.', 'error');
                    setAdminPasswordInput('');
                  }
                }}
                style={{ ...btnStyle('primary'), flex: 1 }}
              >
                Unlock
              </button>
              <button
                onClick={() => { setView('home'); setAdminPasswordInput(''); }}
                style={btnStyle('secondary')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ADMIN ─── */}
      {view === "admin" && (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
          <h1 style={{ margin: "0 0 24px", fontSize: 28 }}>⚙ Admin Dashboard</h1>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, marginBottom: 28, borderBottom: `1px solid ${T.border}`, paddingBottom: 1 }}>
            {[["overview", "📊 Overview"], ["games", "🎮 Games"], ["add", "➕ Add Game"], ["players", "👥 Players"]].map(([tab, label]) => (
              <button key={tab} onClick={() => setAdminTab(tab)} style={{
                ...btnStyle("ghost"), fontSize: 13, borderBottom: adminTab === tab ? `2px solid ${T.accent}` : "2px solid transparent",
                borderRadius: 0, paddingBottom: 10, color: adminTab === tab ? T.accentLight : T.muted,
              }}>{label}</button>
            ))}
          </div>

          {/* Overview */}
          {adminTab === "overview" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
                {[
                  ["Total Games", allGames.length, "🎮"],
                  ["Total Plays", totalPlays, "▶"],
                  ["Scores Submitted", totalScores, "📊"],
                  ["Registered Players", db.players.length, "👥"],
                ].map(([label, val, icon]) => (
                  <div key={label} style={{ background: T.card, borderRadius: 12, padding: 20, border: `1px solid ${T.border}` }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
                    <div style={{ fontSize: 28, fontWeight: 700 }}>{val}</div>
                    <div style={{ color: T.muted, fontSize: 13 }}>{label}</div>
                  </div>
                ))}
              </div>
              <h3 style={{ marginBottom: 16 }}>Most Played</h3>
              {mostPlayed.map((g, i) => (
                <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ color: T.muted, width: 24 }}>#{i + 1}</span>
                  <span style={{ fontSize: 20 }}>{g.thumbnail}</span>
                  <span style={{ flex: 1 }}>{g.name}</span>
                  <span style={{ color: T.muted, fontSize: 13 }}>{db.scores.filter(s => s.gameId === g.id).length} plays</span>
                </div>
              ))}
            </div>
          )}

          {/* Games List */}
          {adminTab === "games" && (
            <div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["", "Name", "Category", "Difficulty", "Plays", "Type", "Added", ""].map(h => <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: T.muted, fontSize: 12, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>)}</tr></thead>
                <tbody>
                  {allGames.map(g => (
                    <tr key={g.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: "10px 12px", fontSize: 20 }}>{g.thumbnail}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>{g.name}</td>
                      <td style={{ padding: "10px 12px", color: T.muted }}>{g.category}</td>
                      <td style={{ padding: "10px 12px" }}><DiffBadge diff={g.difficulty} /></td>
                      <td style={{ padding: "10px 12px", color: T.muted }}>{db.scores.filter(s => s.gameId === g.id).length}</td>
                      <td style={{ padding: "10px 12px" }}><span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: g.type === "builtin" ? "#1D9E7522" : "#7c5cbf22", color: g.type === "builtin" ? T.success : T.accentLight }}>{g.type}</span></td>
                      <td style={{ padding: "10px 12px", color: T.muted, fontSize: 12 }}>{formatDate(g.createdAt)}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {g.type !== "builtin" && <button onClick={() => deleteGame(g.id)} style={{ ...btnStyle("ghost"), color: T.danger, fontSize: 12 }}>Delete</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add Game */}
          {adminTab === "add" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <h3 style={{ margin: "0 0 20px" }}>Game Details</h3>
                {[
                  ["name", "Game Name *", "text", "e.g. Flappy Bird"],
                  ["description", "Description", "text", "What is this game about?"],
                  ["instructions", "Instructions", "text", "How to play..."],
                  ["thumbnail", "Thumbnail Emoji", "text", "e.g. 🐦"],
                ].map(([field, label, type, placeholder]) => (
                  <div key={field} style={{ marginBottom: 14 }}>
                    <label style={{ display: "block", color: T.muted, fontSize: 12, marginBottom: 4, fontWeight: 600 }}>{label}</label>
                    <input
                      value={addGameForm[field]}
                      onChange={e => setAddGameForm({ ...addGameForm, [field]: e.target.value })}
                      placeholder={placeholder}
                      style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14, boxSizing: "border-box" }}
                    />
                  </div>
                ))}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                  <div>
                    <label style={{ display: "block", color: T.muted, fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Category</label>
                    <select value={addGameForm.category} onChange={e => setAddGameForm({ ...addGameForm, category: e.target.value })} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14 }}>
                      {["Arcade", "Puzzle", "Strategy", "Action", "Sports", "Other"].map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", color: T.muted, fontSize: 12, marginBottom: 4, fontWeight: 600 }}>Difficulty</label>
                    <select value={addGameForm.difficulty} onChange={e => setAddGameForm({ ...addGameForm, difficulty: e.target.value })} style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 14 }}>
                      {["Easy", "Medium", "Hard"].map(d => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={generateManifest} disabled={!addGameForm.name || aiLoading} style={{ ...btnStyle("primary"), width: "100%", marginTop: 8, opacity: !addGameForm.name ? 0.5 : 1 }}>
                  {aiLoading ? "⏳ Generating..." : "✨ Generate Manifest with AI"}
                </button>
              </div>

              <div>
                <h3 style={{ margin: "0 0 20px" }}>Generated Manifest</h3>
                <textarea
                  value={aiManifest}
                  onChange={e => setAiManifest(e.target.value)}
                  placeholder='{"id": "game-id", "name": "Game Name", ...}\n\nFill in game details and click "Generate Manifest with AI"'
                  style={{ width: "100%", height: 280, padding: 14, borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.text, fontSize: 12, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }}
                />
                <div style={{ background: T.surface, borderRadius: 8, padding: 14, marginTop: 12, border: `1px solid ${T.border}`, fontSize: 12 }}>
                  <p style={{ color: T.muted, margin: "0 0 8px", fontWeight: 600 }}>📋 How to add a game:</p>
                  <ol style={{ color: T.muted, margin: 0, paddingLeft: 18, lineHeight: 2 }}>
                    <li>Fill in game name, description, and details</li>
                    <li>Click "Generate Manifest with AI"</li>
                    <li>Review and edit the JSON if needed</li>
                    <li>Click "Register Game" — done!</li>
                  </ol>
                </div>
                <button onClick={registerGame} disabled={!addGameForm.name} style={{ ...btnStyle(addGameForm.name ? "primary" : "secondary"), width: "100%", marginTop: 12 }}>
                  ✅ Register Game
                </button>
              </div>
            </div>
          )}

          {/* Players */}
          {adminTab === "players" && (
            <div>
              {db.players.length === 0 ? (
                <p style={{ color: T.muted, textAlign: "center", padding: 40 }}>No players yet.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>{["Player", "Games Played", "Best Score", "Achievements", "Joined"].map(h => <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: T.muted, fontSize: 12, borderBottom: `1px solid ${T.border}`, fontWeight: 600 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {db.players.map(p => {
                      const pScores = db.scores.filter(s => s.playerId === p.id);
                      const best = pScores.length ? Math.max(...pScores.map(s => s.score)) : 0;
                      const achs = db.player_achievements.filter(pa => pa.playerId === p.id).length;
                      return (
                        <tr key={p.id} style={{ borderBottom: `1px solid ${T.border}` }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: p.name === playerName ? T.accentLight : T.text }}>{p.name}{p.name === playerName ? " (you)" : ""}</td>
                          <td style={{ padding: "10px 12px", color: T.muted }}>{pScores.length}</td>
                          <td style={{ padding: "10px 12px", color: T.accentLight, fontWeight: 600 }}>{best.toLocaleString()}</td>
                          <td style={{ padding: "10px 12px", color: T.muted }}>{achs}</td>
                          <td style={{ padding: "10px 12px", color: T.muted, fontSize: 12 }}>{formatDate(p.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes slideIn { from { transform: translateX(100px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${T.bg}; } ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
      `}</style>
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────
function DiffBadge({ diff }) {
  const colors = { Easy: { bg: "#1D9E7522", color: "#1D9E75" }, Medium: { bg: "#EF9F2722", color: "#EF9F27" }, Hard: { bg: "#E24B4A22", color: "#E24B4A" } };
  const c = colors[diff] || colors.Easy;
  return <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: c.bg, color: c.color, fontWeight: 600 }}>{diff}</span>;
}

function GameCard({ game, db, onPlay, onDetail }) {
  const plays = db.scores.filter(s => s.gameId === game.id).length;
  const topScore = db.scores.filter(s => s.gameId === game.id).reduce((max, s) => Math.max(max, s.score), 0);

  return (
    <div style={{
      background: T.card, borderRadius: 14, border: `1px solid ${T.border}`, overflow: "hidden",
      transition: "transform 0.15s, border-color 0.15s", cursor: "pointer",
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.transform = ""; }}
    >
      {/* Thumbnail */}
      <div style={{ height: 100, background: `${game.color}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 52, position: "relative" }}
        onClick={onDetail}>
        {game.thumbnail}
        {game.type === "custom" && <span style={{ position: "absolute", top: 8, right: 8, fontSize: 10, padding: "2px 6px", borderRadius: 4, background: T.accent + "44", color: T.accentLight }}>Custom</span>}
      </div>

      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, cursor: "pointer" }} onClick={onDetail}>{game.name}</h3>
          <DiffBadge diff={game.difficulty} />
        </div>
        <p style={{ color: T.muted, fontSize: 12, margin: "0 0 12px", lineHeight: 1.5 }}>{game.description.slice(0, 80)}{game.description.length > 80 ? "…" : ""}</p>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ color: T.muted, fontSize: 11 }}>▶ {plays}</span>
            {topScore > 0 && <span style={{ color: T.muted, fontSize: 11 }}>🏆 {topScore.toLocaleString()}</span>}
          </div>
          <button onClick={onPlay} style={{ ...btnStyle("primary"), fontSize: 12, padding: "6px 14px" }}>Play</button>
        </div>
      </div>
    </div>
  );
}

function GameDetail({ game, db, getLeaderboard, onPlay, onBack, lastScore }) {
  const leaderboard = getLeaderboard(game.id);
  const scores = db.scores.filter(s => s.gameId === game.id);
  const avgScore = scores.length ? Math.round(scores.reduce((s, e) => s + e.score, 0) / scores.length) : 0;
  const topScore = scores.length ? Math.max(...scores.map(s => s.score)) : 0;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <button onClick={onBack} style={{ ...btnStyle("ghost"), marginBottom: 20, fontSize: 13 }}>← Back to Games</button>

      {/* Hero */}
      <div style={{ background: `${game.color}18`, borderRadius: 16, border: `1px solid ${game.color}44`, padding: 32, marginBottom: 28, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 72 }}>{game.thumbnail}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <h1 style={{ margin: 0, fontSize: 28 }}>{game.name}</h1>
            <DiffBadge diff={game.difficulty} />
            <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "#ffffff11", color: T.muted }}>{game.category}</span>
          </div>
          <p style={{ color: T.muted, margin: "0 0 16px" }}>{game.description}</p>
          <button onClick={onPlay} style={{ ...btnStyle("primary"), fontSize: 15, padding: "10px 28px" }}>▶ Play Now</button>
        </div>
      </div>

      {lastScore !== null && (
        <div style={{ background: T.success + "22", border: `1px solid ${T.success}44`, borderRadius: 10, padding: "12px 20px", marginBottom: 20, color: T.success }}>
          ✓ Your last score: <strong>{lastScore.toLocaleString()}</strong>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Left: Instructions + Stats */}
        <div>
          <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: 20, marginBottom: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>📖 How to Play</h3>
            <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.7, margin: 0 }}>{game.instructions}</p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[["Plays", scores.length, "▶"], ["Best", topScore.toLocaleString(), "🏆"], ["Avg", avgScore.toLocaleString(), "📊"]].map(([l, v, i]) => (
              <div key={l} style={{ background: T.card, borderRadius: 10, border: `1px solid ${T.border}`, padding: "14px 12px", textAlign: "center" }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{i}</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{v}</div>
                <div style={{ color: T.muted, fontSize: 11 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Leaderboard */}
        <div style={{ background: T.card, borderRadius: 12, border: `1px solid ${T.border}`, padding: 20 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>🏆 Leaderboard</h3>
          {leaderboard.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 13, textAlign: "center", padding: 20 }}>No scores yet. Be the first!</p>
          ) : (
            leaderboard.map((entry, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: i < leaderboard.length - 1 ? `1px solid ${T.border}` : "none" }}>
                <span style={{ width: 28, fontWeight: 700, color: i === 0 ? "#EF9F27" : i === 1 ? "#aaa" : i === 2 ? "#cd7f32" : T.muted, fontSize: 14 }}>#{i + 1}</span>
                <span style={{ flex: 1, fontSize: 14 }}>{entry.name}</span>
                <span style={{ fontWeight: 700, color: T.accentLight }}>{entry.score.toLocaleString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
