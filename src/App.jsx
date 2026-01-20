import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  RotateCw, 
  Settings, 
  BookOpen, 
  List, 
  Bookmark, 
  FileText,
  ChevronLeft,
  ChevronRight,
  X,
  Upload,
  Type,
  Moon,
  Sun,
  Library,
  Trash2,
  Plus,
  Image as ImageIcon
} from 'lucide-react';

/**
 * UTILITIES & HELPERS
 */

const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const getORPIndex = (word) => {
  const length = word.length;
  if (length <= 1) return 0;
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  if (length <= 13) return 3;
  return 4;
};

const splitWord = (word) => {
  const match = word.match(/^([^A-Za-z0-9]*)([A-Za-z0-9][A-Za-z0-9'’\-]*)([^A-Za-z0-9]*)$/);
  if (!match) {
    return { leading: "", core: word, trailing: "" };
  }
  return { leading: match[1], core: match[2], trailing: match[3] };
};

const normalizeTrailingForPause = (trailing) => {
  if (!trailing) return "";
  return trailing.replace(/["'”’)\]\}»]+$/g, "");
};

const getPauseMultiplier = (word) => {
  const { trailing } = splitWord(word);
  const cleanedTrailing = normalizeTrailingForPause(trailing);
  if (/[.?!…]+$/.test(cleanedTrailing)) return 2.6;
  if (/[:;]+$/.test(cleanedTrailing)) return 1.9;
  if (/,+$/.test(cleanedTrailing)) return 1.4;
  if (/—|–|--/.test(word)) return 1.6;
  return 1;
};

const normalizeWords = (text) => {
  const normalized = text
    .replace(/([A-Za-z0-9])([—–])([A-Za-z0-9])/g, "$1$2 $3")
    .replace(/\s*([—–])\s*/g, " $1 ");

  return normalized
    .trim()
    .split(/\s+/)
    .filter((word) => splitWord(word).core.length > 0);
};

const stripMarkdown = (text) => {
  let cleaned = text;
  cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");
  cleaned = cleaned.replace(/`[^`]*`/g, " ");
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, " ");
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  cleaned = cleaned.replace(/^\s{0,3}#+\s*/gm, " ");
  cleaned = cleaned.replace(/^\s{0,3}[*+-]\s+/gm, " ");
  cleaned = cleaned.replace(/^\s{0,3}\d+\.\s+/gm, " ");
  cleaned = cleaned.replace(/^\s*>+\s?/gm, " ");
  cleaned = cleaned.replace(/-{3,}/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ");
  return cleaned;
};

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

/**
 * MAIN COMPONENT
 */
export default function App() {
  // --- Global State ---
  const [view, setView] = useState('library'); // 'library' | 'reader'
  const [library, setLibrary] = useState([]); // Array of book metadata
  const [activeBook, setActiveBook] = useState(null); // The book currently being read
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Initializing...');
  const [darkMode, setDarkMode] = useState(true);

  // --- Dependencies ---
  useEffect(() => {
    const init = async () => {
      try {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js');
        
        // Load library metadata from persistence
        const savedLib = localStorage.getItem('speedreader-library');
        if (savedLib) {
          setLibrary(JSON.parse(savedLib));
        }
        
        // Load global settings
        const savedSettings = JSON.parse(localStorage.getItem('speedreader-settings'));
        if (savedSettings?.darkMode !== undefined) setDarkMode(savedSettings.darkMode);

        setIsLoading(false);
      } catch (err) {
        console.error("Failed to load libraries", err);
        setLoadingMessage("Error loading libraries. Check internet connection.");
      }
    };
    init();
  }, []);

  // --- Actions ---

  const handleAddBook = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingMessage('Processing book...');

    try {
      const id = generateId();
      let title = file.name.replace(/\.(epub|txt|md)$/i, '');
      let author = 'Unknown Author';
      let hasCover = false;
      const type = file.name.split('.').pop().toLowerCase();

      // If EPUB, try to extract real metadata and cover
      if (type === 'epub') {
          setLoadingMessage('Extracting cover & metadata...');
          try {
              const buffer = await file.arrayBuffer();
              const book = window.ePub(buffer);
              await book.ready;
              
              // Metadata
              const meta = book.package.metadata;
              if (meta.title) title = meta.title;
              if (meta.creator) author = meta.creator;

              // Cover
              const coverUrl = await book.coverUrl();
              if (coverUrl) {
                  // coverUrl is a blob URL from the internal epub closure. 
                  // We need to fetch it to get the raw blob to store consistently.
                  const response = await fetch(coverUrl);
                  const coverBlob = await response.blob();
                  await window.localforage.setItem(`book-cover-${id}`, coverBlob);
                  hasCover = true;
              }
          } catch (e) {
              console.warn("Metadata extraction failed, falling back to filename", e);
          }
      }

      const metadata = {
        id,
        title,
        author,
        filename: file.name,
        type,
        addedAt: Date.now(),
        progress: 0,
        totalWords: 0,
        hasCover
      };

      // Save actual file blob to indexedDB (localforage)
      await window.localforage.setItem(`book-content-${id}`, file);

      // Update Library State
      const newLibrary = [metadata, ...library];
      setLibrary(newLibrary);
      localStorage.setItem('speedreader-library', JSON.stringify(newLibrary));
      
      setIsLoading(false);
    } catch (err) {
      console.error(err);
      alert('Failed to import book: ' + err.message);
      setIsLoading(false);
    }
  };

  const handleDeleteBook = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this book?')) return;

    // Remove from state
    const newLibrary = library.filter(b => b.id !== id);
    setLibrary(newLibrary);
    localStorage.setItem('speedreader-library', JSON.stringify(newLibrary));

    // Remove content from storage
    await window.localforage.removeItem(`book-content-${id}`);
    await window.localforage.removeItem(`book-cover-${id}`);
    
    // Remove progress
    localStorage.removeItem(`speedreader-progress-${id}`);
  };

  const handleOpenBook = async (book) => {
    setIsLoading(true);
    setLoadingMessage('Opening book...');
    
    try {
      // Fetch content from storage
      const fileBlob = await window.localforage.getItem(`book-content-${book.id}`);
      
      if (!fileBlob) {
        throw new Error("Book content missing from storage.");
      }

      setActiveBook({ ...book, fileBlob });
      setView('reader');
      setIsLoading(false);
    } catch (err) {
      console.error(err);
      alert("Could not open book. It may have been deleted.");
      setIsLoading(false);
    }
  };

  const handleUpdateProgress = (id, progressData) => {
     const newLibrary = library.map(b => {
       if (b.id === id) {
         return { ...b, ...progressData };
       }
       return b;
     });
     setLibrary(newLibrary);
     localStorage.setItem('speedreader-library', JSON.stringify(newLibrary));
  };

  const toggleDarkMode = () => {
      setDarkMode(!darkMode);
      const s = JSON.parse(localStorage.getItem('speedreader-settings') || '{}');
      s.darkMode = !darkMode;
      localStorage.setItem('speedreader-settings', JSON.stringify(s));
  }

  if (view === 'library') {
    return (
      <div className={`min-h-screen p-6 transition-colors duration-300 ${darkMode ? 'bg-zinc-950 text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-2xl font-bold flex items-center gap-3">
              <BookOpen className="text-red-500" /> Library
            </h1>
            <button onClick={toggleDarkMode} className="p-2 hover:bg-white/10 rounded-full">
              {darkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            
            {/* Add Book Button */}
            <label className={`cursor-pointer flex flex-col items-center justify-center aspect-[2/3] rounded-xl border-2 border-dashed transition-all hover:scale-105 active:scale-95 ${darkMode ? 'border-zinc-800 hover:border-zinc-600 bg-zinc-900/50' : 'border-gray-300 hover:border-gray-400 bg-white'}`}>
              <Plus size={48} className="opacity-20 mb-2" />
              <span className="text-sm font-bold opacity-50">Import EPUB/TXT</span>
              <input type="file" onChange={handleAddBook} className="hidden" accept=".epub,.txt,.md" />
            </label>

            {/* Book Cards */}
            {library.map(book => (
              <BookCard 
                key={book.id} 
                book={book} 
                onClick={() => handleOpenBook(book)}
                onDelete={(e) => handleDeleteBook(e, book.id)}
                darkMode={darkMode}
              />
            ))}
          </div>
          
          {isLoading && (
            <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-white">
               <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500 mb-4"></div>
               <p>{loadingMessage}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Reader View
  return (
    <Reader 
        book={activeBook} 
        onBack={() => setView('library')}
        onUpdateProgress={handleUpdateProgress}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
    />
  );
}

/**
 * BOOK CARD COMPONENT
 * Handles async cover loading and display
 */
function BookCard({ book, onClick, onDelete, darkMode }) {
    const [coverUrl, setCoverUrl] = useState(null);

    useEffect(() => {
        let objectUrl = null;
        const loadCover = async () => {
            if (book.hasCover) {
                try {
                    const blob = await window.localforage.getItem(`book-cover-${book.id}`);
                    if (blob) {
                        objectUrl = URL.createObjectURL(blob);
                        setCoverUrl(objectUrl);
                    }
                } catch (e) {
                    console.warn("Failed to load cover", e);
                }
            }
        };
        loadCover();
        return () => {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [book.id, book.hasCover]);

    return (
        <div 
            onClick={onClick}
            className={`group relative flex flex-col p-4 rounded-xl shadow-lg cursor-pointer transition-all hover:translate-y-[-4px] ${darkMode ? 'bg-zinc-900 hover:bg-zinc-800' : 'bg-white hover:bg-gray-50'}`}
        >
            {/* Cover Area */}
            <div className={`aspect-[2/3] w-full rounded-md mb-3 flex items-center justify-center overflow-hidden relative ${darkMode ? 'bg-zinc-800 text-zinc-700' : 'bg-gray-200 text-gray-300'}`}>
                {coverUrl ? (
                    <img src={coverUrl} alt={book.title} className="w-full h-full object-cover" />
                ) : (
                    <div className="flex flex-col items-center justify-center p-4 text-center">
                        <span className="text-4xl font-serif font-bold mb-2">{book.title.charAt(0).toUpperCase()}</span>
                        <Type size={24} className="opacity-20" />
                    </div>
                )}
                
                {/* Overlay Gradient for readability if we wanted text over image, but we have text below */}
            </div>

            <h3 className="font-bold text-sm line-clamp-2 leading-tight mb-1" title={book.title}>{book.title}</h3>
            <p className="text-xs opacity-50 truncate mb-2">{book.author || 'Unknown'}</p>

            <div className="mt-auto pt-2 flex items-center justify-between border-t border-gray-500/10">
                <span className="text-xs font-mono opacity-50">
                    {book.totalWords > 0 ? `${Math.floor(book.progress * 100)}%` : 'NEW'}
                </span>
                <button 
                    onClick={onDelete}
                    className="p-1.5 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-white/10 rounded transition-all"
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
}


/**
 * READER COMPONENT
 * (Encapsulates the reading logic)
 */
function Reader({ book, onBack, onUpdateProgress, darkMode, toggleDarkMode }) {
  // --- State ---
  const [words, setWords] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(300);
  const [altReadingMode, setAltReadingMode] = useState(false);
  const [bookmarks, setBookmarks] = useState([]); 
  const [toc, setToc] = useState([]);
  const [showToc, setShowToc] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [fontSize, setFontSize] = useState(64);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState('Parsing...');
  const [wordScale, setWordScale] = useState(1);
  const [contextLineChars, setContextLineChars] = useState(42);

  const timeoutRef = useRef(null);
  const epubRef = useRef(null);
  const wordWrapperRef = useRef(null);
  const contextRef = useRef(null);
  const chapterStarts = useMemo(() => {
    if (!toc || toc.length === 0) return [];
    const starts = toc
      .map((item) => item.index)
      .filter((idx) => Number.isFinite(idx))
      .sort((a, b) => a - b);
    if (starts.length === 0) return [];
    if (starts[0] !== 0) starts.unshift(0);
    return Array.from(new Set(starts));
  }, [toc]);

  // --- Persistence inside Reader ---
  useEffect(() => {
     // Load settings
     const savedSettings = JSON.parse(localStorage.getItem('speedreader-settings'));
     if (savedSettings) {
         if (savedSettings.wpm) setWpm(savedSettings.wpm);
         if (savedSettings.fontSize) setFontSize(savedSettings.fontSize);
         if (savedSettings.altReadingMode !== undefined) setAltReadingMode(savedSettings.altReadingMode);
     }
  }, []);

  // Save settings change
  useEffect(() => {
      const current = JSON.parse(localStorage.getItem('speedreader-settings') || '{}');
      localStorage.setItem('speedreader-settings', JSON.stringify({ ...current, wpm, fontSize, altReadingMode }));
  }, [wpm, fontSize, altReadingMode]);

  // Save Book Progress (Debounced slightly by effect nature)
  useEffect(() => {
      if (words.length === 0) return;
      
      const progressKey = `speedreader-progress-${book.id}`;
      const data = { currentIndex, bookmarks };
      localStorage.setItem(progressKey, JSON.stringify(data));

      // Also update the library parent state so the card shows correct %
      onUpdateProgress(book.id, { 
          progress: currentIndex / words.length,
          totalWords: words.length
      });

  }, [currentIndex, bookmarks, words.length, book.id]);


  // --- Parsing Logic (Runs once on mount) ---
  useEffect(() => {
      const parseBook = async () => {
          try {
             let resultWords = [];
             let resultToc = [];

             if (book.type === 'epub') {
                 const res = await parseEpub(book.fileBlob);
                 resultWords = res.words;
                 resultToc = res.toc;
             } else {
                 resultWords = await parseText(book.fileBlob);
             }
             
             setWords(resultWords);
             setToc(resultToc);

             // Restore location
             const saved = JSON.parse(localStorage.getItem(`speedreader-progress-${book.id}`));
             if (saved) {
                 if (saved.currentIndex) setCurrentIndex(saved.currentIndex);
                 if (saved.bookmarks) setBookmarks(saved.bookmarks);
             }

             setIsLoading(false);

          } catch (e) {
              console.error(e);
              alert("Error parsing book content.");
              onBack();
          }
      };
      parseBook();
  }, [book]);

  const parseText = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const cleaned = stripMarkdown(text);
        const cleanWords = normalizeWords(cleaned);
        resolve(cleanWords);
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const parseEpub = async (file) => {
    if (!window.ePub) throw new Error("EPUB lib missing");
    
    // EPUBJS needs ArrayBuffer
    const buffer = await file.arrayBuffer();
    const epubBook = window.ePub(buffer);
    epubRef.current = epubBook;
    
    await epubBook.ready;
    const nav = await epubBook.loaded.navigation;
    const spine = await epubBook.loaded.spine;
    
    let fullWordList = [];
    let tocItems = [];
    let currentWordIndex = 0;

    // Helper to find TOC match
    const findToc = (list, href) => {
        for (let item of list) {
            if (href.includes(item.href) || item.href.includes(href)) return item;
            if (item.subitems) {
                const found = findToc(item.subitems, href);
                if (found) return found;
            }
        }
        return null;
    }

    setLoadingMsg("Extracting text...");

    for (const item of spine.spineItems) {
        // Check TOC
        const tocMatch = findToc(nav.toc, item.href);
        if (tocMatch) {
            tocItems.push({ label: tocMatch.label, index: currentWordIndex });
            setLoadingMsg(`Parsing: ${tocMatch.label}...`);
        }

        // Get text
        try {
            const doc = await item.load(epubBook.load.bind(epubBook));
            let rawText = "";

            const removeSelector = (selector) => {
              const nodes = doc.querySelectorAll(selector);
              nodes.forEach((node) => node.remove());
            };

            removeSelector("script");
            removeSelector("style");
            removeSelector("nav");
            removeSelector("noscript");
            removeSelector("header");
            removeSelector("footer");
            removeSelector("svg");
            removeSelector("[role='doc-toc']");
            removeSelector("[role='navigation']");
            removeSelector("[epub\\:type='toc']");
            removeSelector("[epub\\:type='landmarks']");
            removeSelector("#toc");
            removeSelector(".toc");

            if (doc.body?.textContent) rawText = doc.body.textContent;
            else if (doc.documentElement?.textContent) rawText = doc.documentElement.textContent;
            else {
                const nodes = doc.getElementsByTagName("*");
                for(let i=0; i<nodes.length; i++) rawText += (nodes[i].textContent + " ");
            }

            const clean = rawText.replace(/[\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
            if (clean.length > 0) {
                const arr = normalizeWords(clean);
                fullWordList = fullWordList.concat(arr);
                currentWordIndex += arr.length;
            }
            item.unload();
        } catch(e) { console.warn("Section load error", e); }
    }
    
    if (fullWordList.length === 0) throw new Error("Empty book");

    return { words: fullWordList, toc: tocItems };
  };

  // --- Keyboard & Controls ---
  // (Identical to previous, just hooked to new state)
  const jump = useCallback((amount) => {
      setCurrentIndex(prev => {
          const next = prev + amount;
          return Math.max(0, Math.min(words.length - 1, next));
      });
  }, [words.length]);

  const togglePlay = useCallback(() => setIsPlaying(p => !p), []);

  useEffect(() => {
    const handleKey = (e) => {
        if (e.target.tagName === 'INPUT') return;
        switch(e.code) {
            case 'Space': e.preventDefault(); togglePlay(); break;
            case 'ArrowLeft': 
                e.preventDefault(); 
                if (e.ctrlKey||e.metaKey) jump(-50);
                else if (e.shiftKey) jump(-10);
                else jump(-1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (e.ctrlKey||e.metaKey) jump(50);
                else if (e.shiftKey) jump(10);
                else jump(1);
                break;
            case 'ArrowUp': e.preventDefault(); setWpm(w => Math.min(w+10, 1000)); break;
            case 'ArrowDown': e.preventDefault(); setWpm(w => Math.max(w-10, 0)); break;
            case 'Escape': 
                e.preventDefault();
                if (showToc) setShowToc(false);
                else if (showSettings) setShowSettings(false);
                else onBack();
                break;
        }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [togglePlay, jump, showToc, showSettings, onBack]);

  // Interval
  useEffect(() => {
      if (!isPlaying || wpm <= 0 || words.length === 0) {
          clearTimeout(timeoutRef.current);
          return;
      }

      const current = words[currentIndex] || "";
      const ms = (60000 / wpm) * getPauseMultiplier(current);
      timeoutRef.current = setTimeout(() => {
          setCurrentIndex(prev => {
              if (prev >= words.length - 1) {
                  setIsPlaying(false);
                  return prev;
              }
              if (chapterStarts.length > 1) {
                  let nextStart = null;
                  for (let i = 0; i < chapterStarts.length; i += 1) {
                      if (chapterStarts[i] > prev) {
                          nextStart = chapterStarts[i];
                          break;
                      }
                  }
                  if (nextStart !== null) {
                      const chapterEnd = nextStart - 1;
                      if (prev >= chapterEnd) {
                          return nextStart;
                      }
                  }
              }
              return prev + 1;
          });
      }, ms);

      return () => clearTimeout(timeoutRef.current);
  }, [isPlaying, wpm, words.length, currentIndex, chapterStarts]);


  // --- Rendering ---
  const currentWord = words[currentIndex] || "";
  const { leading, core, trailing } = splitWord(currentWord);
  const orp = getORPIndex(core || currentWord);
  const leftPart = `${leading}${(core || currentWord).slice(0, orp)}`;
  const centerChar = (core || currentWord)[orp] || "";
  const rightPart = `${(core || currentWord).slice(orp + 1)}${trailing}`;
  const contextLines = useMemo(() => {
    if (!altReadingMode || words.length === 0) return [];
    const maxChars = Math.max(18, contextLineChars);
    const linesBefore = 3;
    const linesAfter = 3;
    let left = currentIndex - 1;
    let right = currentIndex + 1;

    const before = [];
    let leftIdx = left;
    for (let i = 0; i < linesBefore && leftIdx >= 0; i += 1) {
      const lineWords = [];
      let len = 0;
      while (leftIdx >= 0) {
        const w = words[leftIdx];
        const add = w.length + (len > 0 ? 1 : 0);
        if (len + add > maxChars && len > 0) break;
        lineWords.unshift(w);
        len += add;
        leftIdx -= 1;
      }
      if (lineWords.length > 0) before.push({ text: lineWords.join(" "), distance: i + 1 });
    }
    before.reverse();

    const after = [];
    let rightIdx = right;
    for (let i = 0; i < linesAfter && rightIdx < words.length; i += 1) {
      const lineWords = [];
      let len = 0;
      while (rightIdx < words.length) {
        const w = words[rightIdx];
        const add = w.length + (len > 0 ? 1 : 0);
        if (len + add > maxChars && len > 0) break;
        lineWords.push(w);
        len += add;
        rightIdx += 1;
      }
      if (lineWords.length > 0) after.push({ text: lineWords.join(" "), distance: i + 1 });
    }

    return {
      before,
      after
    };
  }, [altReadingMode, words, currentIndex, contextLineChars]);

  useLayoutEffect(() => {
    const updateScale = () => {
      const node = wordWrapperRef.current;
      if (!node) return;

      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      if (!isMobile) {
        if (wordScale !== 1) setWordScale(1);
        return;
      }

      const maxWidth = Math.min(window.innerWidth * 0.92, node.parentElement?.clientWidth || window.innerWidth);
      const actualWidth = node.scrollWidth;
      const nextScale = actualWidth > maxWidth ? maxWidth / actualWidth : 1;
      const clamped = Math.max(0.6, Math.min(1, nextScale));
      if (clamped !== wordScale) setWordScale(clamped);
    };

    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [currentWord, fontSize, wordScale]);

  useLayoutEffect(() => {
    if (!altReadingMode) return;
    const updateContextWidth = () => {
      const node = contextRef.current;
      const width = node?.clientWidth || window.innerWidth;
      const avgCharWidth = fontSize * 0.55;
      const next = Math.max(18, Math.floor((width - 48) / avgCharWidth));
      if (next !== contextLineChars) setContextLineChars(next);
    };
    updateContextWidth();
    window.addEventListener("resize", updateContextWidth);
    return () => window.removeEventListener("resize", updateContextWidth);
  }, [altReadingMode, fontSize, contextLineChars]);

  const minutesLeft = wpm > 0 ? Math.floor((words.length - currentIndex) / wpm) : 0;
  const progressPercent = words.length > 0 ? Math.floor((currentIndex / words.length) * 100) : 0;

  return (
    <div className={`h-screen w-full flex flex-col transition-colors duration-300 ${darkMode ? 'bg-zinc-950 text-zinc-100' : 'bg-gray-50 text-gray-900'}`}>
        
        {/* Top Bar */}
        <div className={`flex items-center justify-between p-4 border-b z-20 ${darkMode ? 'border-zinc-800' : 'border-gray-200'}`}>
            <div className="flex items-center gap-4">
                <button onClick={onBack} className="flex items-center gap-2 text-sm font-bold opacity-70 hover:opacity-100 transition-opacity">
                    <ChevronLeft size={20} /> Library
                </button>
                <h1 className="font-semibold text-sm md:text-base truncate max-w-[150px] md:max-w-md opacity-50">{book.title}</h1>
            </div>
            <div className="flex items-center gap-2">
                 <button onClick={toggleDarkMode} className="p-2 hover:bg-white/10 rounded-full">
                    {darkMode ? <Sun size={20} /> : <Moon size={20} />}
                </button>
                <button 
                    onClick={() => setShowToc(true)} 
                    disabled={toc.length === 0}
                    className={`p-2 hover:bg-white/10 rounded-full ${toc.length === 0 ? 'opacity-30' : ''}`}
                >
                    <List size={20} />
                </button>
                <button onClick={() => setShowSettings(!showSettings)} className="p-2 hover:bg-white/10 rounded-full">
                    <Settings size={20} />
                </button>
            </div>
        </div>

        {/* Main Area */}
        <div className="flex-1 relative flex items-center justify-center overflow-hidden">
             {isLoading && (
                <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-white">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500 mb-4"></div>
                    <p>{loadingMsg}</p>
                </div>
            )}

            {/* Guides */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-20">
                <div className={`absolute w-full h-[1px] ${darkMode ? 'bg-white' : 'bg-black'} translate-y-[-60px]`}></div>
                <div className={`absolute w-full h-[1px] ${darkMode ? 'bg-white' : 'bg-black'} translate-y-[60px]`}></div>
                <div className={`absolute h-[20px] w-[2px] ${darkMode ? 'bg-red-500' : 'bg-red-600'} translate-y-[-70px]`}></div>
                <div className={`absolute h-[20px] w-[2px] ${darkMode ? 'bg-red-500' : 'bg-red-600'} translate-y-[70px]`}></div>
            </div>

            {/* Word */}
            {!altReadingMode && (
              <div
                  ref={wordWrapperRef}
                  className="font-serif flex items-baseline leading-none select-none relative"
                  style={{
                    fontSize: `${fontSize}px`,
                    transform: `scale(${wordScale})`,
                    transformOrigin: "center center",
                    maxWidth: "92vw"
                  }}
              >
                  <div className="flex justify-end w-[45vw] text-right whitespace-nowrap">{leftPart}</div>
                  <div className={`${darkMode ? 'text-red-500' : 'text-red-600'} font-bold w-auto text-center px-[1px]`}>{centerChar}</div>
                  <div className="flex justify-start w-[45vw] text-left whitespace-nowrap">{rightPart}</div>
                  <div className={`absolute left-1/2 -translate-x-1/2 top-[-20px] bottom-[-20px] w-[2px] opacity-10 ${darkMode ? 'bg-red-500' : 'bg-red-600'}`}></div>
              </div>
            )}
            {altReadingMode && (
              <div
                ref={contextRef}
                className="relative flex flex-col items-center justify-center max-h-[52vh] w-full overflow-hidden px-6"
              >
                <div className="flex flex-col items-stretch w-full gap-2">
                  {contextLines.before.map((line, idx) => {
                    const distance = line.distance;
                    const scale = Math.max(0.35, 1 - 0.2 * distance);
                    const opacity = distance === 1 ? 0.6 : distance === 2 ? 0.45 : 0.35;
                    return (
                      <div
                        key={`before-${idx}`}
                        className={`font-serif leading-none select-none ${darkMode ? 'text-zinc-400' : 'text-gray-500'} overflow-hidden`}
                        style={{ fontSize: `${fontSize * scale}px`, opacity, textAlign: "justify", textAlignLast: "justify", width: "100%" }}
                      >
                        {line.text}
                      </div>
                    );
                  })}

                  <div
                    ref={wordWrapperRef}
                    className="font-serif flex items-baseline leading-none select-none relative"
                    style={{
                      fontSize: `${fontSize}px`,
                      transform: `scale(${wordScale})`,
                      transformOrigin: "center center",
                      maxWidth: "92vw"
                    }}
                  >
                    <div className="flex justify-end w-[45vw] text-right whitespace-nowrap">{leftPart}</div>
                    <div className={`${darkMode ? 'text-red-500' : 'text-red-600'} font-bold w-auto text-center px-[1px]`}>{centerChar}</div>
                    <div className="flex justify-start w-[45vw] text-left whitespace-nowrap">{rightPart}</div>
                    <div className={`absolute left-1/2 -translate-x-1/2 top-[-20px] bottom-[-20px] w-[2px] opacity-10 ${darkMode ? 'bg-red-500' : 'bg-red-600'}`}></div>
                  </div>

                  {contextLines.after.map((line, idx) => {
                    const distance = line.distance;
                    const scale = Math.max(0.35, 1 - 0.2 * distance);
                    const opacity = distance === 1 ? 0.6 : distance === 2 ? 0.45 : 0.35;
                    return (
                      <div
                        key={`after-${idx}`}
                        className={`font-serif leading-none select-none ${darkMode ? 'text-zinc-400' : 'text-gray-500'} overflow-hidden`}
                        style={{ fontSize: `${fontSize * scale}px`, opacity, textAlign: "justify", textAlignLast: "justify", width: "100%" }}
                      >
                        {line.text}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Info */}
            <div className="absolute bottom-8 left-8 text-xs font-mono opacity-40">
                {currentIndex} / {words.length} • {minutesLeft}m left
            </div>
        </div>

        {/* Controls */}
        <div className={`p-4 md:p-6 pb-8 border-t z-20 ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-200'}`}>
            <div className="w-full mb-6 flex items-center gap-3 group">
                <span className="text-xs font-mono opacity-50 min-w-[3ch]">{progressPercent}%</span>
                <div 
                    className="flex-1 h-2 bg-gray-700/30 rounded-full cursor-pointer relative overflow-hidden"
                    onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const pct = (e.clientX - rect.left) / rect.width;
                        jump(Math.floor(pct * words.length) - currentIndex);
                    }}
                >
                    <div className={`absolute top-0 left-0 h-full ${darkMode ? 'bg-red-600' : 'bg-red-500'}`} style={{ width: `${progressPercent}%` }}></div>
                    {bookmarks.map(idx => (
                        <div key={idx} className="absolute top-0 w-[2px] h-full bg-yellow-400 z-10" style={{ left: `${(idx/words.length)*100}%` }}></div>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 max-w-4xl mx-auto">
                {/* Speed */}
                <div className="flex flex-col items-center w-full max-w-[200px]">
                    <div className="flex justify-between w-full text-[10px] font-mono opacity-50 mb-1">
                        <span>0</span><span className="font-bold text-red-500">{wpm} WPM</span><span>1000</span>
                    </div>
                    <input type="range" min="0" max="1000" step="10" value={wpm} onChange={(e) => setWpm(parseInt(e.target.value))} className="w-full accent-red-500 h-1 bg-gray-700/30 rounded-lg appearance-none cursor-pointer" />
                </div>

                {/* Playback */}
                <div className="flex items-center gap-6">
                    <button onClick={(e) => jump(e.shiftKey ? -100 : -50)} className="p-2 hover:text-red-500 transition-colors"><RotateCcw size={20} /></button>
                    <button onClick={(e) => jump(e.shiftKey ? -10 : -1)} className="hover:text-red-500 transition-colors"><ChevronLeft size={24} /></button>
                    <button onClick={togglePlay} className={`p-4 rounded-full ${darkMode ? 'bg-red-600 hover:bg-red-500' : 'bg-red-500 hover:bg-red-600'} text-white shadow-lg transition-transform hover:scale-105 active:scale-95`}>
                        {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
                    </button>
                    <button onClick={(e) => jump(e.shiftKey ? 10 : 1)} className="hover:text-red-500 transition-colors"><ChevronRight size={24} /></button>
                    <button onClick={(e) => jump(e.shiftKey ? 100 : 50)} className="p-2 hover:text-red-500 transition-colors"><RotateCw size={20} /></button>
                </div>

                {/* Bookmark */}
                <button 
                    onClick={() => {
                        if (bookmarks.includes(currentIndex)) setBookmarks(bookmarks.filter(b => b!==currentIndex));
                        else setBookmarks([...bookmarks, currentIndex].sort((a,b)=>a-b));
                    }}
                    className={`flex flex-col items-center gap-1 group ${bookmarks.includes(currentIndex) ? 'text-yellow-500' : 'opacity-50 hover:opacity-100'}`}
                >
                    <Bookmark size={20} fill={bookmarks.includes(currentIndex) ? "currentColor" : "none"} />
                    <span className="text-[10px] uppercase hidden md:block">Mark</span>
                </button>
            </div>
        </div>
        
        {/* TOC Modal */}
        {showToc && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
          <div className={`w-full max-w-md h-full shadow-2xl overflow-hidden flex flex-col ${darkMode ? 'bg-zinc-900' : 'bg-white'}`}>
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h2 className="font-bold text-lg flex items-center gap-2"><List size={20}/> Table of Contents</h2>
              <button onClick={() => setShowToc(false)}><X size={24}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {bookmarks.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-xs font-bold uppercase tracking-widest opacity-50 px-4 py-2">Bookmarks</h3>
                  {bookmarks.map((idx) => (
                    <button 
                      key={idx}
                      onClick={() => { jump(idx - currentIndex); setShowToc(false); }}
                      className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 transition-colors ${darkMode ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'}`}
                    >
                      <Bookmark size={16} className="text-yellow-500" />
                      <span className="truncate flex-1 font-mono text-sm">Word #{idx}</span>
                    </button>
                  ))}
                </div>
              )}
              <h3 className="text-xs font-bold uppercase tracking-widest opacity-50 px-4 py-2">Chapters</h3>
              {toc.length === 0 ? <div className="p-8 text-center opacity-50">No chapters found</div> : 
                toc.map((item, i) => (
                  <button key={i} onClick={() => { jump(item.index - currentIndex); setShowToc(false); }} className={`w-full text-left px-4 py-3 rounded-lg flex items-center justify-between transition-colors ${darkMode ? 'hover:bg-zinc-800' : 'hover:bg-gray-100'}`}>
                    <span className="truncate">{item.label}</span>
                    <span className="text-xs opacity-40 font-mono">{words.length > 0 ? Math.floor((item.index / words.length) * 100) : 0}%</span>
                  </button>
                ))
              }
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className={`absolute top-16 right-4 z-40 w-72 rounded-xl shadow-2xl border overflow-hidden p-4 space-y-4 ${darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-200'}`}>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider opacity-50 block mb-2">Font Size ({fontSize}px)</label>
              <input type="range" min="24" max="128" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full accent-red-500 h-1 bg-gray-700/50 rounded-lg appearance-none cursor-pointer"/>
            </div>
            <div className="pt-2 border-t border-gray-700/50 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider opacity-50">Alt reading mode</span>
              <button
                onClick={() => setAltReadingMode(!altReadingMode)}
                className={`px-3 py-1 text-xs font-bold rounded-full transition-colors ${altReadingMode ? 'bg-red-600 text-white' : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-gray-200 text-gray-700'}`}
              >
                {altReadingMode ? 'On' : 'Off'}
              </button>
            </div>
            <div className="pt-2 border-t border-gray-700/50">
               <h4 className="text-xs font-bold uppercase tracking-wider opacity-50 block mb-2">Shortcuts</h4>
               <ul className="text-xs space-y-1 opacity-70">
                 <li className="flex justify-between"><span>Play/Pause</span> <kbd className="bg-gray-700/50 px-1 rounded">Space</kbd></li>
                 <li className="flex justify-between"><span>1 Word</span> <kbd className="bg-gray-700/50 px-1 rounded">Arrows</kbd></li>
                 <li className="flex justify-between"><span>10 Words</span> <kbd className="bg-gray-700/50 px-1 rounded">Shift+Arr</kbd></li>
                 <li className="flex justify-between"><span>50 Words</span> <kbd className="bg-gray-700/50 px-1 rounded">Ctrl+Arr</kbd></li>
                 <li className="flex justify-between"><span>Exit</span> <kbd className="bg-gray-700/50 px-1 rounded">Esc</kbd></li>
               </ul>
            </div>
        </div>
      )}
    </div>
  );
}
