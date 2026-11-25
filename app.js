/* ============================================================
   ℒone། Besidℓ — listening room logic
   - local library (demo tracks synthesized on demand)
   - uploads → IndexedDB (memory fallback)
   - synced lyrics, likes, favourites, comments
   ============================================================ */
(function () {
  'use strict';

  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => Array.from((root || document).querySelectorAll(s));

  /* ---------------- storage keys ---------------- */
  const LS = {
    tracks: 'lone.tracks.v1',
    social: 'lone.social.v1',
    prefs: 'lone.prefs.v1'
  };

  const state = {
    tracks: [],
    social: { likes: {}, favs: {}, comments: {} },
    prefs: { volume: 0.8, lastId: null, showNow: false },
    view: 'all',
    query: '',
    currentId: null,
    activeLyric: -1,
    seeking: false,
    lyricTarget: null,
    waveId: null
  };

  /* ---------------- dom ---------------- */
  const el = {
    trackList: $('#trackList'),
    libTitle: $('#libTitle'),
    libCount: $('#libCount'),
    search: $('#searchInput'),
    filters: $('#filters'),
    heroPlay: $('#heroPlay'),
    heroPlayText: $('#heroPlayText'),
    heroUpload: $('#heroUpload'),
    railUpload: $('#railUpload'),
    statTracks: $('#statTracks'),
    statLikes: $('#statLikes'),
    statComments: $('#statComments'),
    nowPanel: $('#nowPanel'),
    nowClose: $('#nowClose'),
    nowCover: $('#nowCover'),
    nowGlyph: $('#nowGlyph'),
    nowTitle: $('#nowTitle'),
    nowArtist: $('#nowArtist'),
    lyrics: $('#lyrics'),
    likeBtn: $('#btnLike'),
    likeCount: $('#likeCount'),
    favBtn: $('#btnFav'),
    editLyric: $('#btnEditLyric'),
    download: $('#btnDownload'),
    commentList: $('#commentList'),
    commentCount: $('#commentCount'),
    commentForm: $('#commentForm'),
    commentInput: $('#commentInput'),
    miniCover: $('#miniCover'),
    miniGlyph: $('#miniGlyph'),
    miniTitle: $('#miniTitle'),
    miniArtist: $('#miniArtist'),
    prev: $('#btnPrev'),
    play: $('#btnPlay'),
    next: $('#btnNext'),
    playIcon: $('#playIcon'),
    curTime: $('#curTime'),
    durTime: $('#durTime'),
    seek: $('#seek'),
    waveBase: $('#waveBase'),
    waveFill: $('#waveFill'),
    lyricToggle: $('#lyricToggle'),
    volume: $('#volume'),
    fileInput: $('#fileInput'),
    modal: $('#lyricModal'),
    lyricInput: $('#lyricInput'),
    lyricSave: $('#lyricSave'),
    toast: $('#toast'),
    audio: $('#audio')
  };

  /* ---------------- utils ---------------- */
  const audio = el.audio;

  function escapeHTML(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  function lrcTime(sec) {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return String(m).padStart(2, '0') + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  }

  function timeAgo(at) {
    const diff = Math.max(0, Date.now() - at) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 30) return Math.floor(diff / 86400) + ' 天前';
    return new Date(at).toLocaleDateString('zh-CN');
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-show'), 2400);
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function glyphOf(title) {
    const chars = Array.from(String(title || 'ℒ').trim());
    return chars[0] || 'ℒ';
  }

  const COVER_PALETTES = [
    ['#8c1a2b', '#2a0d13', '#d9b98b'],
    ['#5c6b4e', '#1b2119', '#c9a227'],
    ['#6d2331', '#1d0f14', '#bfa07a'],
    ['#3f4a3a', '#141713', '#cbb58f'],
    ['#7a2a2a', '#1c1011', '#d4a373']
  ];

  function coverBackground(id) {
    const h = hashStr(id);
    const r = mulberry32(h);
    const p = COVER_PALETTES[h % COVER_PALETTES.length];
    const ang = 110 + Math.round(r() * 150);
    const x1 = (18 + r() * 34).toFixed(1);
    const y1 = (16 + r() * 30).toFixed(1);
    const x2 = (56 + r() * 34).toFixed(1);
    const y2 = (56 + r() * 30).toFixed(1);
    return [
      'radial-gradient(circle at ' + x1 + '% ' + y1 + '%, ' + p[0] + 'd9, transparent 62%)',
      'radial-gradient(circle at ' + x2 + '% ' + y2 + '%, ' + p[1] + 'f2, transparent 68%)',
      'radial-gradient(circle at 50% 52%, ' + p[2] + '1a, transparent 72%)',
      'linear-gradient(' + ang + 'deg, #1a1214, #0a0809 74%)'
    ].join(',');
  }

  function coverMarkup(track) {
    return '<span class="vline"></span><span class="gl">' + escapeHTML(glyphOf(track.title)) + '</span>';
  }

  /* ---------------- blob store (IndexedDB + memory fallback) ---------------- */
  const memStore = new Map();
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      let req;
      try { req = indexedDB.open('lone-beside', 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return dbPromise;
  }

  async function putAudio(key, blob) {
    memStore.set(key, blob);
    const db = await openDB();
    if (!db) return;
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('audio', 'readwrite');
        tx.objectStore('audio').put(blob, key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (e) { /* memory only */ }
  }

  async function getAudio(key) {
    if (!key) return null;
    if (memStore.has(key)) return memStore.get(key);
    const db = await openDB();
    if (!db) return null;
    try {
      return await new Promise((resolve) => {
        const tx = db.transaction('audio', 'readonly');
        const req = tx.objectStore('audio').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch (e) { return null; }
  }

  /* ---------------- wav synthesis (demo tracks) ---------------- */
  const SAMPLE_RATE = 22050;
  const DEMO_SECONDS = 32;

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function addTone(out, freq, start, dur, opts) {
    const o = opts || {};
    const gain = o.gain == null ? 0.1 : o.gain;
    const atk = o.attack == null ? 0.01 : o.attack;
    const rel = o.release == null ? 0.4 : o.release;
    const type = o.type || 'sine';
    const detune = o.detune || 0;
    const decay = o.decay || 3;
    const f0 = freq * Math.pow(2, detune / 1200);
    const i0 = Math.floor(start * SAMPLE_RATE);
    const n = Math.floor(dur * SAMPLE_RATE);
    const w = (2 * Math.PI * f0) / SAMPLE_RATE;
    const len = out.length;
    for (let j = 0; j < n; j++) {
      const i = i0 + j;
      if (i >= len) break;
      if (i < 0) continue;
      const tt = j / SAMPLE_RATE;
      let env;
      if (type === 'pluck') {
        env = Math.exp(-tt * decay);
      } else {
        env = tt < atk ? tt / atk : 1;
        if (tt > dur - rel) env *= Math.max(0, (dur - tt) / rel);
      }
      let s;
      if (type === 'pluck') {
        s = Math.sin(w * j) + 0.28 * Math.sin(2 * w * j) * Math.exp(-tt * 3.4) + 0.1 * Math.sin(3 * w * j) * Math.exp(-tt * 5);
      } else {
        s = Math.sin(w * j) + 0.16 * Math.sin(2 * w * j) + 0.05 * Math.sin(3 * w * j);
      }
      out[i] += s * env * gain;
    }
  }

  function encodeWav(samples) {
    const len = samples.length;
    const size = 44 + len * 2;
    const buf = new ArrayBuffer(size);
    const v = new DataView(buf);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    v.setUint32(4, size - 8, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, SAMPLE_RATE, true);
    v.setUint32(28, SAMPLE_RATE * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, len * 2, true);
    let off = 44;
    for (let i = 0; i < len; i++) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  function synthWav(seed) {
    const total = SAMPLE_RATE * DEMO_SECONDS;
    const out = new Float32Array(total);
    const rand = mulberry32((seed || 1) + 7);
    const chords = [
      [57, 60, 64, 71],   // Am(add9)
      [53, 57, 60, 67],   // Fmaj9
      [50, 53, 57, 64],   // Dm9
      [52, 56, 59, 62]    // E7
    ];
    const bars = 8;
    const barSec = DEMO_SECONDS / bars;

    for (let b = 0; b < bars; b++) {
      const ch = chords[b % chords.length];
      const t0 = b * barSec;
      addTone(out, midiToFreq(ch[0] - 24), t0, barSec * 1.02, {
        gain: 0.12, attack: 1.1, release: 1.5
      });
      ch.forEach((m, i) => {
        addTone(out, midiToFreq(m), t0 + i * 0.014, barSec, {
          gain: 0.048, attack: 1.5, release: 1.3, detune: (rand() - 0.5) * 9
        });
        addTone(out, midiToFreq(m + 12), t0 + i * 0.02, barSec, {
          gain: 0.017, attack: 2.1, release: 1.6
        });
      });
    }

    // sparse motif with echo
    let step = 0;
    for (let t = 0.6; t < DEMO_SECONDS - 1.2; t += 0.75, step++) {
      if (step % 4 === 3) continue;
      const ch = chords[Math.floor(t / barSec) % chords.length];
      const pool = [ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[0] + 24, ch[2] + 24];
      const note = midiToFreq(pool[Math.floor(rand() * pool.length)]);
      const g = 0.04 + rand() * 0.022;
      addTone(out, note, t, 1.7, { gain: g, attack: 0.006, release: 1.5, type: 'pluck', decay: 2.6 });
      addTone(out, note, t + 0.45, 1.4, { gain: g * 0.26, attack: 0.006, release: 1.3, type: 'pluck', decay: 3.4 });
      addTone(out, note * 2, t + 0.9, 1.1, { gain: g * 0.1, attack: 0.01, release: 1.0, type: 'pluck', decay: 4.2 });
    }

    let peak = 0;
    for (let i = 0; i < total; i++) {
      const a = Math.abs(out[i]);
      if (a > peak) peak = a;
    }
    const norm = peak > 0 ? 0.84 / peak : 1;
    const fadeIn = SAMPLE_RATE * 1.8;
    const fadeOut = SAMPLE_RATE * 3;
    for (let i = 0; i < total; i++) {
      let v = out[i] * norm;
      if (i < fadeIn) v *= i / fadeIn;
      if (i > total - fadeOut) v *= (total - i) / fadeOut;
      out[i] = v;
    }
    return encodeWav(out);
  }

  /* ---------------- seeded library ---------------- */
  const DEMOS = [
    {
      id: 'demo-mirror',
      title: 'Mirror, Beside',
      artist: 'ℒone',
      dur: DEMO_SECONDS,
      demo: true,
      seed: 17,
      baseLikes: 1284,
      addedAt: Date.now() - 1000 * 60 * 60 * 30,
      lyrics: [
        { t: 1.0, text: '镜子的另一边，你与我并肩' },
        { t: 4.8, text: 'Mirror, breathing at my side' },
        { t: 8.6, text: '红线缝合两段沉默' },
        { t: 12.4, text: 'We wear the same quiet' },
        { t: 16.2, text: '把心跳调成同一个频率' },
        { t: 20.0, text: '夜色替我们保守秘密' },
        { t: 23.8, text: 'Stay — just beside' },
        { t: 27.6, text: '直到所有的灯都熄灭' }
      ]
    },
    {
      id: 'demo-olive',
      title: 'Olive & Gold',
      artist: 'Besidℓ',
      dur: DEMO_SECONDS,
      demo: true,
      seed: 42,
      baseLikes: 876,
      addedAt: Date.now() - 1000 * 60 * 60 * 18,
      lyrics: [
        { t: 1.0, text: '橄榄绿与旧金色' },
        { t: 4.8, text: 'Two blades resting, side by side' },
        { t: 8.6, text: '你说别回头' },
        { t: 12.4, text: 'But your eyes said stay' },
        { t: 16.2, text: '我们把誓言藏进袖口' },
        { t: 20.0, text: '让风带走多余的姓名' },
        { t: 23.8, text: 'Hold the line, hold me' },
        { t: 27.6, text: '天亮之前，别松手' }
      ]
    },
    {
      id: 'demo-redlight',
      title: '红灯之后',
      artist: 'ℒone ། Besidℓ',
      dur: DEMO_SECONDS,
      demo: true,
      seed: 93,
      baseLikes: 2043,
      addedAt: Date.now() - 1000 * 60 * 60 * 6,
      lyrics: [
        { t: 1.0, text: '红灯亮起，我们停在同一秒' },
        { t: 4.8, text: 'After the red light, nothing changes' },
        { t: 8.6, text: '你的影子比你先开口' },
        { t: 12.4, text: 'I answer with a smile' },
        { t: 16.2, text: '人群穿过我们之间的缝隙' },
        { t: 20.0, text: '谁也没有走出这一步' },
        { t: 23.8, text: 'Wait for the light with me' },
        { t: 27.6, text: '再久一点，也没关系' }
      ]
    }
  ];

  const SEED_COMMENTS = {
    'demo-mirror': [
      { name: '夜航者', text: '第三句一出来，鸡皮疙瘩。', at: Date.now() - 1000 * 60 * 52 },
      { name: '银线', text: '适合深夜一个人循环。', at: Date.now() - 1000 * 60 * 60 * 5 }
    ],
    'demo-olive': [
      { name: 'sable', text: '前奏像旧电影的片头。', at: Date.now() - 1000 * 60 * 60 * 9 }
    ],
    'demo-redlight': [
      { name: '阿椋', text: '“再久一点，也没关系”——被这句击中。', at: Date.now() - 1000 * 60 * 60 * 2 }
    ]
  };

  /* ---------------- persistence ---------------- */
  function loadStored() {
    try {
      const t = JSON.parse(localStorage.getItem(LS.tracks) || 'null');
      if (Array.isArray(t) && t.length) state.tracks = t;
    } catch (e) { /* ignore */ }
    try {
      const s = JSON.parse(localStorage.getItem(LS.social) || 'null');
      if (s && typeof s === 'object') {
        state.social = {
          likes: s.likes || {},
          favs: s.favs || {},
          comments: s.comments || {}
        };
      }
    } catch (e) { /* ignore */ }
    try {
      const p = JSON.parse(localStorage.getItem(LS.prefs) || 'null');
      if (p && typeof p === 'object') state.prefs = Object.assign(state.prefs, p);
    } catch (e) { /* ignore */ }
  }

  function saveTracks() {
    try { localStorage.setItem(LS.tracks, JSON.stringify(state.tracks)); } catch (e) { /* ignore */ }
  }

  function saveSocial() {
    try { localStorage.setItem(LS.social, JSON.stringify(state.social)); } catch (e) { /* ignore */ }
  }

  function savePrefs() {
    try { localStorage.setItem(LS.prefs, JSON.stringify(state.prefs)); } catch (e) { /* ignore */ }
  }

  function likeOf(track) {
    if (!state.social.likes[track.id]) {
      state.social.likes[track.id] = {
        count: track.baseLikes || 0,
        me: false
      };
    }
    return state.social.likes[track.id];
  }

  function favOf(track) {
    return !!state.social.favs[track.id];
  }

  function commentsOf(track) {
    if (!state.social.comments[track.id]) state.social.comments[track.id] = [];
    return state.social.comments[track.id];
  }

  function current() {
    return state.tracks.find((t) => t.id === state.currentId) || null;
  }

  /* ---------------- rendering ---------------- */
  function filteredTracks() {
    const q = state.query.trim().toLowerCase();
    return state.tracks.filter((t) => {
      if (state.view === 'favs' && !favOf(t)) return false;
      if (state.view === 'mine' && t.demo) return false;
      if (q) {
        const hay = (t.title + ' ' + t.artist).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function trackRow(track, index) {
    const like = likeOf(track);
    const playing = state.currentId === track.id;
    const isPlaying = playing && !audio.paused;
    return (
      '<article class="track' + (playing ? ' is-current' : '') + '" data-id="' + track.id + '" ' +
      'style="animation-delay:' + Math.min(index, 10) * 0.03 + 's">' +
        '<div class="track-cover cover" style="' + coverBackground(track.id) + '">' + coverMarkup(track) + '</div>' +
        '<div class="track-main">' +
          '<h3>' + escapeHTML(track.title) + '</h3>' +
          '<p>' + escapeHTML(track.artist) +
            '<span class="dot">·</span>' + fmtTime(track.dur) +
            (track.lyrics && track.lyrics.length ? '<span class="dot">·</span>字幕' : '') +
          '</p>' +
        '</div>' +
        '<div class="track-side">' +
          '<div class="track-eq" aria-hidden="true"><i></i><i></i><i></i></div>' +
          '<button class="track-like' + (like.me ? ' is-on' : '') + '" data-act="like" type="button" aria-label="点赞">' +
            '<svg class="ic" viewBox="0 0 24 24"><use href="#i-heart"/></svg>' +
            '<span>' + formatCount(like.count) + '</span>' +
          '</button>' +
          '<button class="track-fav' + (favOf(track) ? ' is-on' : '') + '" data-act="fav" type="button" aria-label="收藏">' +
            '<svg class="ic" viewBox="0 0 24 24"><use href="#i-bookmark"/></svg>' +
          '</button>' +
        '</div>' +
        '<button class="track-play" data-act="play" type="button" aria-label="播放 ' + escapeHTML(track.title) + '">' +
          '<svg class="ic" viewBox="0 0 24 24"><use href="#' + (isPlaying ? 'i-pause' : 'i-play') + '"/></svg>' +
        '</button>' +
      '</article>'
    );
  }

  function formatCount(n) {
    n = Number(n) || 0;
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
    return n.toLocaleString('zh-CN');
  }

  function renderTracks() {
    const list = filteredTracks();
    el.libTitle.textContent = state.view === 'favs' ? '收藏' : state.view === 'mine' ? '我的上传' : '曲库';
    el.libCount.textContent = list.length ? list.length + ' 首' : '';

    if (!list.length) {
      let msg;
      if (state.query) msg = '<b>没有找到「' + escapeHTML(state.query) + '」</b>换个关键词试试。';
      else if (state.view === 'favs') msg = '<b>收藏还是空的</b>点开一首歌，在右侧按下书签。';
      else if (state.view === 'mine') msg = '<b>还没有上传</b>把本地音频拖进来，或点「上传歌曲」。';
      else msg = '<b>曲库是空的</b>上传第一首歌吧。';
      el.trackList.innerHTML = '<div class="empty">' + msg + '</div>';
      return;
    }
    el.trackList.innerHTML = list.map(trackRow).join('');
  }

  function renderLyrics(track) {
    state.activeLyric = -1;
    if (!track) {
      el.lyrics.innerHTML =
        '<div class="lyrics-empty"><svg class="ic" viewBox="0 0 24 24"><use href="#i-lines"/></svg>' +
        '<p>播放时，字幕会在这里逐句亮起。</p></div>';
      return;
    }
    if (!track.lyrics || !track.lyrics.length) {
      el.lyrics.innerHTML =
        '<div class="lyrics-empty"><svg class="ic" viewBox="0 0 24 24"><use href="#i-lines"/></svg>' +
        '<p>这首歌还没有字幕。<br>点下方「字幕」补上歌词。</p></div>';
      return;
    }
    el.lyrics.innerHTML = track.lyrics.map((line, i) =>
      '<button class="lyric-line" data-i="' + i + '" type="button">' + escapeHTML(line.text) + '</button>'
    ).join('');
    if (loadedId === track.id && audio.currentTime > 0) syncLyrics(audio.currentTime);
    else syncLyrics(0);
  }

  function renderComments(track) {
    const list = track ? commentsOf(track) : [];
    el.commentCount.textContent = list.length;
    if (!list.length) {
      el.commentList.innerHTML = '<div class="comment-empty">' +
        (track ? '还没有留言，写下第一句。' : '选一首歌，留下你的话。') + '</div>';
      return;
    }
    el.commentList.innerHTML = list.slice().reverse().map((c) =>
      '<div class="comment">' +
        '<div class="av">' + escapeHTML(String(c.name).slice(0, 1)) + '</div>' +
        '<div class="body">' +
          '<div class="row"><span class="name">' + escapeHTML(c.name) + '</span>' +
          '<span class="time">' + timeAgo(c.at) + '</span></div>' +
          '<p class="text">' + escapeHTML(c.text) + '</p>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  function renderNow(options) {
    const opts = options || {};
    const track = current();

    el.nowCover.style.cssText = track ? coverBackground(track.id) : '';
    el.miniCover.style.cssText = track ? coverBackground(track.id) : '';
    el.nowGlyph.textContent = track ? glyphOf(track.title) : 'ℒ';
    el.miniGlyph.textContent = track ? glyphOf(track.title) : 'ℒ';

    if (!track) {
      el.nowTitle.textContent = '还没有选中歌曲';
      el.nowArtist.textContent = '从曲库挑一首，或上传你自己的歌';
      el.miniTitle.textContent = '未播放';
      el.miniArtist.textContent = 'ℒone། Besidℓ';
      el.likeCount.textContent = '0';
      el.likeBtn.classList.remove('is-on');
      el.favBtn.classList.remove('is-on');
      el.curTime.textContent = '0:00';
      el.durTime.textContent = '0:00';
    } else {
      el.nowTitle.textContent = track.title;
      el.nowArtist.textContent = track.artist + ' · ' + fmtTime(track.dur);
      el.miniTitle.textContent = track.title;
      el.miniArtist.textContent = track.artist;
      const like = likeOf(track);
      el.likeCount.textContent = formatCount(like.count);
      el.likeBtn.classList.toggle('is-on', !!like.me);
      el.likeBtn.setAttribute('aria-pressed', String(!!like.me));
      el.favBtn.classList.toggle('is-on', favOf(track));
      el.favBtn.setAttribute('aria-pressed', String(favOf(track)));
      el.favBtn.querySelector('span').textContent = favOf(track) ? '已收藏' : '收藏';
      el.durTime.textContent = fmtTime(audio.duration || track.dur);
    }

    if (opts.lyrics !== false) renderLyrics(track);
    renderComments(track);
    if (track && state.waveId !== track.id) {
      state.waveId = track.id;
      buildWave(track.id);
      el.seek.style.setProperty('--p', '0%');
    }
    if (!track) {
      state.waveId = null;
      el.waveBase.innerHTML = '';
      el.waveFill.innerHTML = '';
    }
  }

  function renderStats() {
    let likes = 0;
    let comments = 0;
    let favs = 0;
    state.tracks.forEach((t) => {
      likes += likeOf(t).count;
      comments += commentsOf(t).length;
      if (favOf(t)) favs += 1;
    });
    el.statTracks.textContent = String(state.tracks.length);
    el.statLikes.textContent = formatCount(likes);
    el.statComments.textContent = String(comments);
    return favs;
  }

  function setView(view) {
    state.view = view;
    $$('.rail-item[data-view]').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    $$('#filters button').forEach((b) => b.classList.toggle('is-active', b.dataset.filter === view));
    renderTracks();
  }

  function refreshPlayState() {
    const playing = !audio.paused;
    $$('#trackList .track').forEach((row) => {
      const on = row.dataset.id === state.currentId;
      row.classList.toggle('is-current', on);
      const use = row.querySelector('.track-play use');
      if (use) use.setAttribute('href', on && playing ? '#i-pause' : '#i-play');
    });
  }

  function setPlayingUI(playing) {
    document.body.classList.toggle('is-playing', playing);
    document.body.classList.toggle('is-paused', !playing);
    el.playIcon.firstElementChild.setAttribute('href', playing ? '#i-pause' : '#i-play');
    el.play.setAttribute('aria-label', playing ? '暂停' : '播放');
    el.heroPlayText.textContent = playing ? '正在播放' : (state.currentId ? '继续聆听' : '开始聆听');
    refreshPlayState();
  }

  function buildWave(id) {
    const rand = mulberry32(hashStr(id));
    const bars = 84;
    let html = '';
    for (let i = 0; i < bars; i++) {
      const h = 12 + Math.pow(rand(), 1.35) * 88;
      html += '<span style="height:' + h.toFixed(1) + '%"></span>';
    }
    el.waveBase.innerHTML = html;
    el.waveFill.innerHTML = html;
  }

  /* ---------------- social actions ---------------- */
  function toggleLike(id) {
    const track = state.tracks.find((t) => t.id === id);
    if (!track) return;
    const like = likeOf(track);
    if (like.me) {
      like.me = false;
      like.count = Math.max(0, like.count - 1);
    } else {
      like.me = true;
      like.count += 1;
      toast('已喜欢 · ' + track.title);
    }
    saveSocial();
    renderTracks();
    renderStats();
    if (state.currentId === id) renderNow({ lyrics: false });
  }

  function toggleFav(id) {
    const track = state.tracks.find((t) => t.id === id);
    if (!track) return;
    if (state.social.favs[id]) {
      delete state.social.favs[id];
      toast('已取消收藏');
    } else {
      state.social.favs[id] = true;
      toast('已收藏 · ' + track.title);
    }
    saveSocial();
    renderTracks();
    renderStats();
    if (state.currentId === id) renderNow({ lyrics: false });
  }

  /* ---------------- audio playback ---------------- */
  const urlCache = new Map();
  const pendingSrc = new Map();
  let loadedId = null;

  async function ensureDemoBlob(track) {
    toast('正在准备音轨…');
    await new Promise((r) => setTimeout(r, 30));
    const blob = synthWav(track.seed);
    await putAudio(track.blobKey, blob);
    return blob;
  }

  async function ensureSrc(track) {
    if (urlCache.has(track.id)) return urlCache.get(track.id);
    if (pendingSrc.has(track.id)) return pendingSrc.get(track.id);
    const job = (async () => {
      let blob = await getAudio(track.blobKey);
      if (!blob && track.demo) blob = await ensureDemoBlob(track);
      if (!blob) throw new Error('音频文件已失效，请重新上传这首歌');
      const url = URL.createObjectURL(blob);
      urlCache.set(track.id, url);
      return url;
    })();
    pendingSrc.set(track.id, job);
    try {
      return await job;
    } finally {
      pendingSrc.delete(track.id);
    }
  }

  async function playTrack(id, opts) {
    const track = state.tracks.find((t) => t.id === id);
    if (!track) return;
    const options = opts || {};

    if (state.currentId === id && audio.src && loadedId === id && !options.restart) {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      return;
    }

    state.currentId = id;
    state.prefs.lastId = id;
    savePrefs();
    renderNow({ lyrics: true });
    renderTracks();
    el.seek.style.setProperty('--p', '0%');
    el.curTime.textContent = '0:00';

    try {
      const url = await ensureSrc(track);
      if (state.currentId !== id) return;
      loadedId = id;
      audio.src = url;
      audio.currentTime = 0;
      await audio.play();
    } catch (err) {
      if (state.currentId !== id) return;
      console.error(err);
      if (err && err.name === 'NotAllowedError') toast('浏览器拦截了播放，请再点一次播放');
      else toast(err && err.message ? err.message : '音频加载失败');
      setPlayingUI(false);
    }
  }

  function step(dir) {
    if (!state.tracks.length) return;
    const idx = state.tracks.findIndex((t) => t.id === state.currentId);
    let next = idx === -1 ? 0 : (idx + dir + state.tracks.length) % state.tracks.length;
    playTrack(state.tracks[next].id, { restart: true });
  }

  function syncLyrics(time) {
    const track = current();
    if (!track || !track.lyrics || !track.lyrics.length) return;
    let idx = -1;
    for (let i = 0; i < track.lyrics.length; i++) {
      if (time + 0.08 >= track.lyrics[i].t) idx = i;
      else break;
    }
    if (idx === state.activeLyric) return;
    const prev = el.lyrics.querySelector('.lyric-line.is-active');
    if (prev) prev.classList.remove('is-active');
    state.activeLyric = idx;
    if (idx < 0) return;
    const line = el.lyrics.querySelector('.lyric-line[data-i="' + idx + '"]');
    if (!line) return;
    line.classList.add('is-active');
    const top = line.offsetTop - el.lyrics.clientHeight / 2 + line.offsetHeight / 2;
    el.lyrics.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  function seekTo(clientX) {
    if (!audio.duration) return;
    const rect = el.seek.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    el.seek.style.setProperty('--p', (ratio * 100).toFixed(2) + '%');
    el.curTime.textContent = fmtTime(ratio * audio.duration);
  }

  /* ---------------- uploads ---------------- */
  const AUDIO_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|webm|weba|aiff|aif)$/i;

  function readDuration(file) {
    return new Promise((resolve) => {
      const probe = document.createElement('audio');
      const url = URL.createObjectURL(file);
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(v);
      };
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => done(isFinite(probe.duration) ? probe.duration : 0);
      probe.onerror = () => done(0);
      setTimeout(() => done(isFinite(probe.duration) ? probe.duration : 0), 4000);
      probe.src = url;
    });
  }

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) =>
      (f.type && f.type.indexOf('audio') === 0) || AUDIO_EXT.test(f.name)
    );
    if (!files.length) {
      toast('请选择音频文件（mp3 / wav / flac …）');
      return;
    }

    toast('正在读取 ' + files.length + ' 个文件…');
    const added = [];
    for (const file of files) {
      const id = 'u-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const blobKey = 'audio:' + id;
      const dur = await readDuration(file);
      await putAudio(blobKey, file);
      added.push({
        id: id,
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: '我的上传',
        dur: Math.round(dur * 10) / 10,
        demo: false,
        blobKey: blobKey,
        fileName: file.name,
        mime: file.type || 'audio/mpeg',
        lyrics: [],
        addedAt: Date.now()
      });
    }

    state.tracks = added.concat(state.tracks);
    saveTracks();
    added.forEach((t) => {
      likeOf(t);
      commentsOf(t);
    });
    saveSocial();

    state.query = '';
    el.search.value = '';
    if (state.view !== 'all') setView('all');
    else renderTracks();
    renderStats();

    audio.pause();
    state.currentId = added[0].id;
    state.prefs.lastId = state.currentId;
    savePrefs();
    renderNow({ lyrics: true });
    el.seek.style.setProperty('--p', '0%');
    el.curTime.textContent = '0:00';
    el.durTime.textContent = fmtTime(added[0].dur);
    setPlayingUI(false);
    toast('已添加 ' + added.length + ' 首 · 点播放开始听');
  }

  /* ---------------- lyric editor ---------------- */
  function parseLyricText(text, duration) {
    const raw = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!raw.length) return [];
    const timed = [];
    let timedCount = 0;
    raw.forEach((line) => {
      const m = line.match(/^\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\]\s*(.*)$/);
      if (m) {
        timedCount += 1;
        timed.push({ t: Number(m[1]) * 60 + parseFloat(m[2]), text: m[3].trim() });
      } else {
        timed.push({ t: null, text: line });
      }
    });

    if (timedCount > 0) {
      return timed
        .map((line, i) => {
          if (line.t != null) return line;
          const prev = timed[i - 1] && timed[i - 1].t != null ? timed[i - 1].t : 0;
          return { t: prev + 3, text: line.text };
        })
        .filter((line) => line.text)
        .sort((a, b) => a.t - b.t);
    }

    const n = timed.length;
    const start = 1;
    const end = Math.max(4, (duration || DEMO_SECONDS) - 3);
    return timed.map((line, i) => ({
      t: n === 1 ? start : start + ((end - start) * i) / (n - 1),
      text: line.text
    }));
  }

  function openLyricModal() {
    const track = current();
    if (!track) {
      toast('先选一首歌');
      return;
    }
    state.lyricTarget = track.id;
    el.lyricInput.value = (track.lyrics || [])
      .map((line) => '[' + lrcTime(line.t) + '] ' + line.text)
      .join('\n');
    el.modal.classList.add('is-open');
    el.modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => { el.lyricInput.focus(); el.lyricInput.setSelectionRange(0, 0); }, 120);
  }

  function closeLyricModal() {
    el.modal.classList.remove('is-open');
    el.modal.setAttribute('aria-hidden', 'true');
    state.lyricTarget = null;
  }

  function saveLyrics() {
    const track = state.tracks.find((t) => t.id === state.lyricTarget) || current();
    if (!track) return;
    const live = state.currentId === track.id && isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : 0;
    const dur = live || track.dur || DEMO_SECONDS;
    const lines = parseLyricText(el.lyricInput.value, dur);
    track.lyrics = lines;
    saveTracks();
    if (state.currentId === track.id) {
      renderLyrics(track);
      syncLyrics(audio.currentTime || 0);
    }
    renderTracks();
    closeLyricModal();
    toast(lines.length ? '字幕已保存 · ' + lines.length + ' 句' : '已清空字幕');
  }

  /* ---------------- download ---------------- */
  async function downloadCurrent() {
    const track = current();
    if (!track) {
      toast('先选一首歌');
      return;
    }
    const blob = await getAudio(track.blobKey) || (track.demo ? await ensureDemoBlob(track) : null);
    if (!blob) {
      toast('音频文件不可用');
      return;
    }
    const ext = track.fileName && /\.\w+$/.test(track.fileName)
      ? track.fileName.match(/\.\w+$/)[0]
      : '.wav';
    const name = track.fileName || (track.title + ' - ' + track.artist + ext).replace(/[\\/:*?"<>|]/g, '_');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('开始下载 · ' + name);
  }

  /* ---------------- events ---------------- */
  function bindEvents() {
    // rail / filters
    $$('.rail-item[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    });
    el.filters.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (btn) setView(btn.dataset.filter);
    });

    // search
    el.search.addEventListener('input', () => {
      state.query = el.search.value;
      renderTracks();
    });

    // upload
    const pickFile = () => el.fileInput.click();
    el.heroUpload.addEventListener('click', pickFile);
    el.railUpload.addEventListener('click', pickFile);
    el.fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      el.fileInput.value = '';
    });

    // track list
    el.trackList.addEventListener('click', (e) => {
      const row = e.target.closest('.track');
      if (!row) return;
      const id = row.dataset.id;
      const actBtn = e.target.closest('[data-act]');
      if (actBtn) {
        const act = actBtn.dataset.act;
        if (act === 'like') toggleLike(id);
        else if (act === 'fav') toggleFav(id);
        else if (act === 'play') playTrack(id);
        return;
      }
      playTrack(id);
    });

    // transport
    el.play.addEventListener('click', () => {
      if (!state.currentId) {
        const first = state.tracks[0];
        if (first) playTrack(first.id);
        else toast('曲库还是空的');
        return;
      }
      if (!audio.src || loadedId !== state.currentId) {
        playTrack(state.currentId);
        return;
      }
      if (audio.paused) audio.play().catch(() => toast('点击后再试一次'));
      else audio.pause();
    });
    el.prev.addEventListener('click', () => step(-1));
    el.next.addEventListener('click', () => step(1));
    el.heroPlay.addEventListener('click', () => {
      if (!state.currentId) {
        if (state.tracks[0]) playTrack(state.tracks[0].id);
        else toast('先上传一首歌');
        return;
      }
      if (!audio.src || audio.paused) playTrack(state.currentId);
      else audio.pause();
    });

    // seek
    el.seek.addEventListener('pointerdown', (e) => {
      state.seeking = true;
      el.seek.setPointerCapture(e.pointerId);
      seekTo(e.clientX);
    });
    el.seek.addEventListener('pointermove', (e) => {
      if (state.seeking) seekTo(e.clientX);
    });
    const endSeek = () => { state.seeking = false; };
    el.seek.addEventListener('pointerup', endSeek);
    el.seek.addEventListener('pointercancel', endSeek);

    // audio events
    audio.addEventListener('play', () => setPlayingUI(true));
    audio.addEventListener('pause', () => setPlayingUI(false));
    audio.addEventListener('ended', () => step(1));
    audio.addEventListener('loadedmetadata', () => {
      const track = current();
      if (!track) return;
      if (!track.dur || Math.abs(track.dur - audio.duration) > 1.5) {
        track.dur = Math.round(audio.duration * 10) / 10;
        saveTracks();
        renderTracks();
        renderNow({ lyrics: false });
      }
      el.durTime.textContent = fmtTime(audio.duration);
    });
    audio.addEventListener('timeupdate', () => {
      const dur = audio.duration || (current() ? current().dur : 0);
      if (!state.seeking) {
        const pct = dur ? (audio.currentTime / dur) * 100 : 0;
        el.seek.style.setProperty('--p', pct.toFixed(2) + '%');
        el.curTime.textContent = fmtTime(audio.currentTime);
      }
      el.durTime.textContent = fmtTime(dur);
      syncLyrics(audio.currentTime);
    });
    audio.addEventListener('error', () => {
      toast('音频无法播放，文件可能已损坏');
      setPlayingUI(false);
    });

    // volume
    el.volume.addEventListener('input', () => {
      audio.volume = Number(el.volume.value);
      state.prefs.volume = audio.volume;
      savePrefs();
    });

    // like / fav / download / lyrics
    el.likeBtn.addEventListener('click', () => {
      if (!state.currentId) return toast('先选一首歌');
      toggleLike(state.currentId);
    });
    el.favBtn.addEventListener('click', () => {
      if (!state.currentId) return toast('先选一首歌');
      toggleFav(state.currentId);
    });
    el.download.addEventListener('click', downloadCurrent);
    el.editLyric.addEventListener('click', openLyricModal);
    el.lyricSave.addEventListener('click', saveLyrics);
    $$('#lyricModal [data-close]').forEach((b) => b.addEventListener('click', closeLyricModal));
    el.modal.addEventListener('click', (e) => {
      if (e.target === el.modal) closeLyricModal();
    });

    // lyric seek
    el.lyrics.addEventListener('click', (e) => {
      const line = e.target.closest('.lyric-line');
      if (!line) return;
      const track = current();
      if (!track || !track.lyrics) return;
      const item = track.lyrics[Number(line.dataset.i)];
      if (!item) return;
      if (!audio.src || loadedId !== state.currentId) {
        toast('先按播放');
        return;
      }
      audio.currentTime = Math.max(0, item.t);
      syncLyrics(item.t);
    });

    // subtitle panel toggle
    el.lyricToggle.addEventListener('click', () => {
      if (window.innerWidth <= 980) {
        const open = document.body.classList.toggle('show-now');
        el.lyricToggle.classList.toggle('is-on', open);
        state.prefs.showNow = open;
        savePrefs();
        if (open) renderNow({ lyrics: true });
        return;
      }
      renderNow({ lyrics: true });
      const active = el.lyrics.querySelector('.lyric-line.is-active') || el.lyrics.querySelector('.lyric-line');
      if (active) {
        el.lyrics.scrollTo({
          top: Math.max(0, active.offsetTop - el.lyrics.clientHeight / 2 + active.offsetHeight / 2),
          behavior: 'smooth'
        });
      }
    });
    el.nowClose.addEventListener('click', () => {
      document.body.classList.remove('show-now');
      el.lyricToggle.classList.remove('is-on');
      state.prefs.showNow = false;
      savePrefs();
    });

    // comments
    el.commentForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const track = current();
      if (!track) return toast('先选一首歌');
      const text = el.commentInput.value.trim();
      if (!text) return;
      commentsOf(track).push({ name: '你', text: text, at: Date.now() });
      saveSocial();
      el.commentInput.value = '';
      renderComments(track);
      renderStats();
      renderTracks();
      el.commentList.scrollTop = 0;
      toast('留言已发送');
    });

    // keyboard
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        if (e.key === 'Escape' && el.modal.classList.contains('is-open')) closeLyricModal();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        el.play.click();
      } else if (e.key === 'ArrowRight') {
        if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
      } else if (e.key === 'ArrowLeft') {
        if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
      } else if (e.key === 'Escape' && el.modal.classList.contains('is-open')) {
        closeLyricModal();
      }
    });
  }

  /* ---------------- boot ---------------- */
  function init() {
    loadStored();

    if (!state.tracks.length) {
      state.tracks = DEMOS.map((t) => JSON.parse(JSON.stringify(t)));
      saveTracks();
    } else {
      // make sure demo metadata stays intact if older storage is missing fields
      state.tracks.forEach((t) => {
        if (t.demo) {
          const demo = DEMOS.find((d) => d.id === t.id);
          if (demo) {
            if (!t.lyrics || !t.lyrics.length) t.lyrics = demo.lyrics;
          }
        }
      });
    }

    state.tracks.forEach((t) => {
      if (t.demo && !state.social.comments[t.id] && SEED_COMMENTS[t.id]) {
        state.social.comments[t.id] = SEED_COMMENTS[t.id].map((c) => Object.assign({}, c));
      }
      likeOf(t);
      commentsOf(t);
    });
    saveSocial();

    audio.volume = typeof state.prefs.volume === 'number' ? state.prefs.volume : 0.8;
    el.volume.value = String(audio.volume);

    const startId = state.prefs.lastId && state.tracks.some((t) => t.id === state.prefs.lastId)
      ? state.prefs.lastId
      : (state.tracks[0] ? state.tracks[0].id : null);
    state.currentId = startId;

    renderTracks();
    renderStats();
    renderNow({ lyrics: true });
    if (state.currentId) el.durTime.textContent = fmtTime(current().dur);
    if (state.prefs.showNow && window.innerWidth <= 980) {
      document.body.classList.add('show-now');
      el.lyricToggle.classList.add('is-on');
    }
    setPlayingUI(false);
    bindEvents();
  }

  init();
})();
