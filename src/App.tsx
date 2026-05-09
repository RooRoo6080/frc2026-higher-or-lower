import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, RefreshCw, Trophy, Play, Check, X, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { fetchAllTeams, fetchTeamImage, preloadImage, shuffle, StatboticsTeam, GameTeam, fetchTeamBlueBanners } from './lib/api';
import { cn } from './lib/utils';

type GameState = 'SETUP' | 'LOADING_INITIAL' | 'PLAYING' | 'REVEALING' | 'GAME_OVER';

export default function App() {
  const [gameMode, setGameMode] = useState<'EPA' | 'BANNERS'>('EPA');
  const [gameState, setGameState] = useState<GameState>('SETUP');

  const [availableTeams, setAvailableTeams] = useState<StatboticsTeam[]>([]);
  const [loadedTeams, setLoadedTeams] = useState<GameTeam[]>([]);
  
  const availableTeamsRef = useRef<StatboticsTeam[]>([]);
  const loadedTeamsRef = useRef<GameTeam[]>([]);

  const syncState = () => {
      setAvailableTeams([...availableTeamsRef.current]);
      setLoadedTeams([...loadedTeamsRef.current]);
  };

  const [streak, setStreak] = useState(0);
  const [highScoreEPA, setHighScoreEPA] = useState<number>(() => parseInt(localStorage.getItem('frc_high_score_epa') || '0', 10));
  const [highScoreBanners, setHighScoreBanners] = useState<number>(() => parseInt(localStorage.getItem('frc_high_score_banners') || '0', 10));
  
  const [guessState, setGuessState] = useState<'IDLE' | 'CORRECT' | 'WRONG'>('IDLE');
  const isFetchingRef = useRef(false);

  // Background queue maintenance loop
  const maintainQueue = async () => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      try {
          while (loadedTeamsRef.current.length < 6 && availableTeamsRef.current.length > 0) {
              const batch = availableTeamsRef.current.splice(0, 5); // Take 5 to evaluate in parallel

              const promises = batch.map(async (t) => {
                  try {
                      if (gameMode === 'EPA') {
                          const imgUrl = await fetchTeamImage(t.team);
                          if (imgUrl) {
                              const isValid = await preloadImage(imgUrl);
                              if (isValid) {
                                  return {
                                      teamNumber: t.team,
                                      name: t.name,
                                      epa: Math.round(t.epa.total_points.mean * 10) / 10,
                                      imageUrl: imgUrl
                                  } as GameTeam;
                              }
                          }
                      } else {
                          const banners = await fetchTeamBlueBanners(t.team);
                          if (banners !== null && banners > 0) {
                              return {
                                  teamNumber: t.team,
                                  name: t.name,
                                  blueBanners: banners
                              } as GameTeam;
                          }
                      }
                  } catch (e: any) {
                      console.error(e);
                  }
                  return null;
              });

              const results = await Promise.all(promises);
              const valid = results.filter((r): r is GameTeam => r !== null);
              
              if (valid.length > 0) {
                  const existingIds = new Set(loadedTeamsRef.current.map(lt => lt.teamNumber));
                  const newUnique = valid.filter(v => !existingIds.has(v.teamNumber));
                  loadedTeamsRef.current = [...loadedTeamsRef.current, ...newUnique];
                  syncState();
              }
          }
      } catch (e: any) {
         console.error(e);
      } finally {
          isFetchingRef.current = false;
      }
  };

  useEffect(() => {
    if (gameState === 'LOADING_INITIAL') {
      initializeGame();
    }
  }, [gameState]);

  useEffect(() => {
     if ((gameState === 'PLAYING' || gameState === 'REVEALING' || gameState === 'LOADING_INITIAL') && loadedTeamsRef.current.length < 6) {
         maintainQueue();
     }
  }, [gameState, availableTeams.length, loadedTeams.length]);

  const initializeGame = async () => {
    setStreak(0);
    setGuessState('IDLE');
    loadedTeamsRef.current = [];
    syncState();
    
    try {
      if (availableTeamsRef.current.length === 0) {
          const teams = await fetchAllTeams();
          availableTeamsRef.current = shuffle(teams);
      } else {
          // If already filled, just shuffle the rest of what we got
          availableTeamsRef.current = shuffle(availableTeamsRef.current);
      }
      syncState();
      
      // Kick off queue maintenance to start finding valid images
      await maintainQueue();

      // Wait until we have at least 2 teams to play
      const checkInterval = setInterval(() => {
          if (loadedTeamsRef.current.length >= 2) {
              clearInterval(checkInterval);
              setGameState('PLAYING');
          }
      }, 500);
      
      // Safety timeout after 15 seconds if API is extremely sparse
      setTimeout(() => clearInterval(checkInterval), 15000);

    } catch (e) {
      console.error(e);
    }
  };

  const startNewGame = () => {
      setGameState('LOADING_INITIAL');
  };

  const handleModeSelect = (mode: 'EPA' | 'BANNERS') => {
    setGameMode(mode);
    setGameState('LOADING_INITIAL');
  };

  const handleGuess = (type: 'HIGHER' | 'LOWER') => {
      if (loadedTeams.length < 2 || gameState !== 'PLAYING') return;
      const tA = loadedTeams[0];
      const tB = loadedTeams[1];
      
      setGameState('REVEALING');
      
      let isHigher = false;
      if (gameMode === 'EPA') {
          isHigher = (tB.epa || 0) >= (tA.epa || 0);
      } else {
          isHigher = (tB.blueBanners || 0) >= (tA.blueBanners || 0);
      }
      
      const isCorrect = (type === 'HIGHER' && isHigher) || (type === 'LOWER' && !isHigher);
      
      setGuessState(isCorrect ? 'CORRECT' : 'WRONG');
      
      setTimeout(() => {
          if (isCorrect) {
              const newStreak = streak + 1;
              setStreak(newStreak);
              if (gameMode === 'EPA' && newStreak > highScoreEPA) {
                  setHighScoreEPA(newStreak);
                  localStorage.setItem('frc_high_score_epa', newStreak.toString());
              } else if (gameMode === 'BANNERS' && newStreak > highScoreBanners) {
                  setHighScoreBanners(newStreak);
                  localStorage.setItem('frc_high_score_banners', newStreak.toString());
              }
              // shift array and go back to playing
              loadedTeamsRef.current = loadedTeamsRef.current.slice(1);
              syncState();
              setGuessState('IDLE');
              setGameState('PLAYING');
          } else {
              setGameState('GAME_OVER');
          }
      }, 2000);
  };

  if (gameState === 'SETUP') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans text-slate-100">
        <div className="max-w-md w-full bg-slate-900 rounded-3xl shadow-2xl border border-slate-800 p-8 text-center space-y-8">
            <div className="w-16 h-16 bg-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg">
                <Trophy className="w-8 h-8 text-white" />
            </div>
            <div>
                <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Higher or Lower</h1>
                <p className="text-slate-400 font-medium tracking-widest uppercase text-xs">FRC Edition</p>
                <p className="text-sm text-slate-400 mt-4 leading-relaxed">
                  Test your FRC knowledge. Choose a mode to play.
                </p>
            </div>
            
            <div className="space-y-4 pt-2">
                <button 
                  onClick={() => handleModeSelect('EPA')}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg"
                >
                  <Play className="w-5 h-5 fill-current" />
                  Statbotics EPA Mode
                </button>
                <button 
                  onClick={() => handleModeSelect('BANNERS')}
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg"
                >
                  <Trophy className="w-5 h-5" />
                  Blue Banners Mode
                </button>
            </div>
        </div>
      </div>
    );
  }

  if (gameState === 'LOADING_INITIAL') {
      return (
        <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center font-sans text-slate-100">
            <RefreshCw className="w-12 h-12 text-indigo-500 animate-spin mb-6" />
            <p className="text-slate-300 font-medium text-xl animate-pulse tracking-wide">Loading Teams</p>
        </div>
      );
  }

  const teamA = loadedTeams[0];
  const teamB = loadedTeams[1];

  return (
    <div className="h-[100dvh] w-full bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
        {/* Navigation / Header */}
        <header className="h-20 px-4 md:px-8 flex items-center justify-between bg-slate-900/50 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"></path></svg>
                </div>
                <div className="hidden sm:block">
                    <h1 className="text-xl font-bold tracking-tight text-white line-clamp-1">ROBOT HIGHER/LOWER</h1>
                    <p className="text-xs text-slate-400 uppercase tracking-widest line-clamp-1">2026 Championship Edition</p>
                </div>
            </div>
            
            <div className="flex items-center gap-4 md:gap-8">
                <div className="text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Current Streak</p>
                    <p className="text-2xl md:text-3xl font-black text-indigo-400 leading-none">{streak}</p>
                </div>
                <div className="text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Best Score</p>
                    <p className="text-2xl md:text-3xl font-black text-slate-200 leading-none">{gameMode === 'EPA' ? highScoreEPA : highScoreBanners}</p>
                </div>
                <button 
                    onClick={() => {
                        setGameState('SETUP');
                    }}
                    className="ml-2 bg-slate-900 border border-slate-700 hover:bg-slate-800 p-2.5 rounded-lg text-slate-400 hover:text-white transition-colors"
                    title="Change Mode"
                >
                    <Settings className="w-5 h-5" />
                </button>
            </div>
        </header>

        {/* Game Arena */}
        <main className="flex-1 flex flex-col md:flex-row p-4 md:p-8 gap-4 md:gap-8 items-stretch md:overflow-hidden overflow-y-auto">
            
            {/* Team A */}
            {teamA ? (
              <div className="flex-1 bg-slate-900 rounded-3xl border border-slate-800 flex flex-col overflow-hidden shadow-2xl relative min-h-[60vh] md:min-h-0">
                  <div className="absolute top-4 left-4 z-20">
                    <span className="px-3 py-1 bg-slate-950/80 backdrop-blur-md rounded-full text-xs font-bold border border-slate-700">TEAM {teamA.teamNumber}</span>
                  </div>
                  {gameMode === 'EPA' ? (
                      <div className="flex-1 min-h-0 bg-slate-800 relative grow shrink">
                          <img src={teamA.imageUrl} alt={teamA.name} className="absolute inset-0 w-full h-full object-cover object-center" />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/20 to-transparent z-10 pointer-events-none"></div>
                      </div>
                  ) : (
                      <div className="flex-1 min-h-0 bg-slate-800 relative grow shrink flex items-center justify-center overflow-hidden">
                          <div className="absolute inset-0 bg-emerald-900/20 mix-blend-multiply"></div>
                          <p className="text-[12rem] font-black text-slate-700/20 pointer-events-none select-none absolute transform -rotate-12">{teamA.teamNumber}</p>
                      </div>
                  )}
                  
                  <div className="p-6 md:p-8 flex flex-col justify-between z-20 relative bg-slate-900 shrink-0">
                      <div className="mb-4 md:mb-0">
                          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 line-clamp-2">{teamA.name}</h2>
                          <p className="text-slate-400 text-sm">Team {teamA.teamNumber}</p>
                      </div>
                      
                      <div className="bg-slate-950/50 p-6 rounded-2xl border border-slate-800/50">
                          <p className="text-xs text-slate-500 uppercase mb-2">{gameMode === 'EPA' ? 'Statbotics EPA' : 'Blue Banners'}</p>
                          <p className="text-5xl md:text-6xl font-black text-white tracking-tighter italic">{gameMode === 'EPA' ? teamA.epa : teamA.blueBanners}</p>
                      </div>
                  </div>
              </div>
            ) : <div className="flex-1 flex items-center justify-center bg-slate-900 rounded-3xl border border-slate-800" />}

            {/* Versus Divider */}
            <div className="w-full md:w-px h-px md:h-full bg-slate-800 relative flex items-center justify-center shrink-0 my-2 md:my-0">
                 <div className="absolute w-12 h-12 bg-indigo-600 rounded-full border-4 border-slate-950 flex items-center justify-center font-black italic text-white z-30">VS</div>
            </div>

            {/* Team B */}
            {teamB ? (
              <div className="flex-1 bg-slate-900 rounded-3xl border border-indigo-500/30 flex flex-col overflow-hidden shadow-2xl relative min-h-[60vh] md:min-h-0">
                  <div className="absolute top-4 right-4 z-20">
                    <span className="px-3 py-1 bg-indigo-600 rounded-full text-xs font-bold shadow-lg">NEXT UP</span>
                  </div>
                  {gameMode === 'EPA' ? (
                      <div className="flex-1 min-h-0 bg-slate-800 relative grow shrink">
                          <img src={teamB.imageUrl} alt={teamB.name} className="absolute inset-0 w-full h-full object-cover object-center" />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/20 to-transparent z-10 pointer-events-none"></div>
                      </div>
                  ) : (
                      <div className="flex-1 min-h-0 bg-slate-800 relative grow shrink flex items-center justify-center overflow-hidden">
                          <div className="absolute inset-0 bg-indigo-900/20 mix-blend-multiply"></div>
                          <p className="text-[12rem] font-black text-slate-700/20 pointer-events-none select-none absolute transform -rotate-12">{teamB.teamNumber}</p>
                      </div>
                  )}
                  
                  <div className="p-6 md:p-8 flex flex-col justify-between z-20 relative bg-slate-900 shrink-0">
                      <div className="text-left md:text-right mb-6 md:mb-0">
                          <h2 className="text-2xl md:text-3xl font-bold text-white mb-1 line-clamp-2">{teamB.name}</h2>
                          <p className="text-slate-400 text-sm">Team {teamB.teamNumber}</p>
                      </div>
                      
                      <div className="w-full">
                          {gameState === 'PLAYING' ? (
                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={() => handleGuess('HIGHER')}
                                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black py-3 rounded-xl text-xl flex items-center justify-center gap-2 group transition-colors"
                                >
                                    <span>HIGHER</span>
                                    <svg className="w-6 h-6 transform transition-transform group-hover:-translate-y-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 15l7-7 7 7"></path></svg>
                                </button>
                                <button
                                    onClick={() => handleGuess('LOWER')}
                                    className="w-full bg-rose-500 hover:bg-rose-400 text-rose-950 font-black py-3 rounded-xl text-xl flex items-center justify-center gap-2 group transition-colors"
                                >
                                    <span>LOWER</span>
                                    <svg className="w-6 h-6 transform transition-transform group-hover:translate-y-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M19 9l-7 7-7-7"></path></svg>
                                </button>
                            </div>
                          ) : (
                              <AnimatePresence>
                                <motion.div 
                                    initial={{ scale: 0.8, opacity: 0, y: 20 }}
                                    animate={{ scale: 1, opacity: 1, y: 0 }}
                                    className="bg-slate-950/50 p-6 rounded-2xl border border-slate-800/50 text-left md:text-right"
                                >
                                    <p className="text-xs text-slate-500 uppercase mb-2">{gameMode === 'EPA' ? 'Statbotics EPA' : 'Blue Banners'}</p>
                                    <motion.p 
                                        initial={{ y: 10, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        transition={{ delay: 0.0 }}
                                        className={cn(
                                            "text-5xl md:text-6xl font-black tracking-tighter italic whitespace-nowrap",
                                            guessState === 'CORRECT' ? "text-emerald-400" : "text-rose-400"
                                        )}
                                    >
                                        {gameMode === 'EPA' ? teamB.epa : teamB.blueBanners}
                                    </motion.p>
                                    
                                    <div className="flex justify-start md:justify-end mt-2">
                                        {guessState === 'CORRECT' && (
                                            <motion.div 
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                transition={{ type: "spring", bounce: 0.5 }}
                                                className="flex items-center gap-2 text-emerald-400"
                                            >
                                                <Check className="w-5 h-5 stroke-[3]" />
                                                <span className="font-bold tracking-wide uppercase text-sm">Correct</span>
                                            </motion.div>
                                        )}
                                        {guessState === 'WRONG' && (
                                            <motion.div
                                                initial={{ scale: 0 }}
                                                animate={{ scale: 1 }}
                                                transition={{ type: "spring", bounce: 0.5 }}
                                                className="flex items-center gap-2 text-rose-400"
                                            >
                                                <X className="w-5 h-5 stroke-[3]" />
                                                <span className="font-bold tracking-wide uppercase text-sm">Wrong</span>
                                            </motion.div>
                                        )}
                                    </div>
                                </motion.div>
                              </AnimatePresence>
                          )}
                      </div>
                  </div>
              </div>
            ) : <div className="flex-1 flex items-center justify-center bg-slate-900 rounded-3xl border border-slate-800" />}
        </main>

        {/* Footer Info */}
        <footer className="h-12 px-4 md:px-8 flex items-center justify-between text-[10px] text-slate-600 uppercase tracking-widest border-t border-slate-900 bg-slate-950 shrink-0">
            <div className="flex gap-2 md:gap-4 flex-wrap">
                <span>Source: The Blue Alliance</span>
                <span className="hidden sm:inline">|</span>
                <span className="hidden sm:inline">Data: Statbotics.io</span>
            </div>
            <div className="flex gap-2 md:gap-4 text-right">
                <span className="hidden sm:inline">Season: 2026 REEFSCAPE</span>
                <span className="text-slate-400">v2.6.4-stable</span>
            </div>
        </footer>

        {/* Game Over Overlay */}
        <AnimatePresence>
            {gameState === 'GAME_OVER' && (
                <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-[100] bg-slate-950/80 backdrop-blur-lg flex items-center justify-center p-6 text-center text-white"
                >
                    <motion.div 
                        initial={{ scale: 0.9, y: 30 }}
                        animate={{ scale: 1, y: 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 25 }}
                        className="max-w-sm w-full bg-slate-900 border border-slate-800 rounded-[2rem] p-8 md:p-10 shadow-2xl relative overflow-hidden"
                    >
                        <div className="absolute -top-32 -inset-x-10 h-64 bg-indigo-600/20 blur-3xl rounded-full pointer-events-none"></div>

                        <div className="w-20 h-20 bg-rose-500/10 border border-rose-500/20 rounded-full flex items-center justify-center mx-auto text-rose-500 mb-6 relative z-10 shadow-lg shadow-rose-500/10">
                            <X className="w-10 h-10 stroke-[3]" />
                        </div>
                        
                        <h2 className="text-4xl font-black tracking-tight text-white mb-2 relative z-10 drop-shadow-md">Game Over</h2>
                        <p className="text-slate-400 mb-8 relative z-10 font-medium">You guessed incorrectly.</p>
                        
                        <div className="bg-slate-950/50 rounded-2xl p-6 border border-slate-800 mb-8 relative z-10">
                            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-1.5">Final Score</p>
                            <p className="text-6xl font-black text-white italic">{streak}</p>
                        </div>
                        
                        <button
                            onClick={startNewGame}
                            className="w-full bg-white text-slate-900 hover:bg-slate-200 font-black py-4 px-6 rounded-xl flex items-center justify-center gap-2 transition-transform hover:scale-105 active:scale-95 shadow-xl relative z-10 text-lg"
                        >
                            <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                            PLAY AGAIN
                        </button>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>

    </div>
  );
}
