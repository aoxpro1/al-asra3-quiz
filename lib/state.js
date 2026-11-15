"use strict";

const {
  LETTERS,
  currentAnswers,
  answerByPlayer,
  elapsedMs,
  remainingMs,
  durationMs,
  speedRankFor,
  statsForPlayer,
  standings,
  displayMode,
} = require("./game");

function playerById(game, playerId) {
  return game.players.find((p) => p.id === playerId) || null;
}

function makeOnlineFn(isOnline) {
  return typeof isOnline === "function" ? isOnline : () => false;
}

function publicPlayers(game, online) {
  return game.players.map((player) => ({
    name: player.name,
    online: Boolean(online(player.id)),
  }));
}

function leaderboardFor(game, online, includeUnrevealed = false) {
  return standings(game, { includeUnrevealed }).map((row) => ({
    ...row,
    online: Boolean(online(row.playerId)),
  }));
}

function baseState(game, online) {
  const now = Date.now();
  const question = game.currentIndex >= 0 ? game.questions[game.currentIndex] : null;
  return {
    serverNow: now,
    code: game.code,
    title: game.title,
    maxPlayers: game.maxPlayers,
    status: game.status,
    phase: game.phase,
    totalQuestions: game.questions.length,
    currentIndex: game.currentIndex,
    questionNumber: game.currentIndex + 1,
    durationMs: durationMs(game),
    elapsedMs: Math.min(durationMs(game), elapsedMs(game, now)),
    remainingMs: remainingMs(game, now),
    paused: Boolean(game.qPaused),
    timeUp: Boolean(game.qTimeUp),
    playerCount: game.players.length,
    players: publicPlayers(game, online),
    answerCount: currentAnswers(game).length,
  };
}

function currentAnswerRows(game, online) {
  return currentAnswers(game)
    .slice()
    .sort((a, b) => a.elapsedMs - b.elapsedMs || a.at - b.at)
    .map((answer) => {
      const player = playerById(game, answer.playerId);
      return {
        playerId: answer.playerId,
        name: player ? player.name : "لاعب",
        online: player ? Boolean(online(player.id)) : false,
        optionIndex: answer.optionIndex,
        optionLabel: LETTERS[answer.optionIndex],
        correct: Boolean(answer.correct),
        points: answer.points,
        elapsedMs: answer.elapsedMs,
      };
    });
}

function resultsFor(game, online) {
  const answers = currentAnswers(game);
  const rows = game.players.map((player) => {
    const answer = answerByPlayer(game, game.currentIndex, player.id);
    return {
      playerId: player.id,
      name: player.name,
      online: Boolean(online(player.id)),
      answered: Boolean(answer),
      optionIndex: answer ? answer.optionIndex : null,
      optionLabel: answer ? LETTERS[answer.optionIndex] : null,
      correct: Boolean(answer && answer.correct),
      points: answer ? answer.points : 0,
      elapsedMs: answer ? answer.elapsedMs : null,
      speedRank: answer && answer.correct ? speedRankFor(game, game.currentIndex, player.id) : 0,
    };
  });
  rows.sort((a, b) => {
    if (a.answered !== b.answered) return a.answered ? -1 : 1;
    if (!a.answered) return 0;
    return a.elapsedMs - b.elapsedMs;
  });
  return rows;
}

function answeredNamesFor(game) {
  const names = [];
  for (const answer of currentAnswers(game)) {
    const player = playerById(game, answer.playerId);
    if (player) names.push(player.name);
  }
  return names;
}

function projectDisplayState(game, isOnline) {
  if (!game) {
    return {
      mode: "welcome",
      serverNow: Date.now(),
      playerCount: 0,
      leaderboard: [],
    };
  }
  const online = makeOnlineFn(isOnline);
  const state = baseState(game, online);
  const mode = displayMode(game);
  const question = game.currentIndex >= 0 ? game.questions[game.currentIndex] : null;
  const revealed = ["revealed", "leaderboard", "podium"].includes(mode);
  return {
    ...state,
    mode,
    question: question
      ? {
          text: question.text,
          options: question.options,
          timer: question.timer,
          category: question.category,
        }
      : null,
    correctIndex: revealed && question ? question.correctIndex : null,
    explanation: revealed && question ? question.explanation : "",
    results: revealed ? resultsFor(game, online) : [],
    answeredNames: mode === "question" ? answeredNamesFor(game) : [],
    leaderboard: leaderboardFor(game, online),
    winner:
      game.status === "finished" && game.winnerName
        ? {
            name: game.winnerName,
            ...(game.winnerId ? statsForPlayer(game, game.winnerId) : { total: 0, correctCount: 0 }),
          }
        : null,
  };
}

function projectAdminState(game, isOnline) {
  if (!game) {
    return {
      mode: "setup",
      serverNow: Date.now(),
      game: null,
    };
  }
  const online = makeOnlineFn(isOnline);
  const state = baseState(game, online);
  const question = game.currentIndex >= 0 ? game.questions[game.currentIndex] : null;
  const answers = currentAnswerRows(game, online);
  const answeredIds = new Set(answers.map((answer) => answer.playerId));
  const resultVisible = ["revealed", "leaderboard", "podium"].includes(displayMode(game));
  const players = game.players.map((player) => {
    const answer = answerByPlayer(game, game.currentIndex, player.id);
    const stats = statsForPlayer(game, player.id);
    const projected = statsForPlayer(game, player.id, true);
    return {
      id: player.id,
      name: player.name,
      online: Boolean(online(player.id)),
      joinedAt: player.joinedAt,
      total: stats.total,
      correctCount: stats.correctCount,
      answersCount: stats.answersCount,
      projectedTotal: projected.total,
      currentAnswer: answer
        ? {
            optionIndex: answer.optionIndex,
            optionLabel: LETTERS[answer.optionIndex],
            correct: answer.correct,
            points: answer.points,
            elapsedMs: answer.elapsedMs,
          }
        : null,
    };
  });
  return {
    ...state,
    mode: displayMode(game),
    game: {
      id: game.id,
      code: game.code,
      title: game.title,
      status: game.status,
      phase: game.phase,
      maxPlayers: game.maxPlayers,
      totalQuestions: game.questions.length,
      currentIndex: game.currentIndex,
      questionNumber: game.currentIndex + 1,
      players,
      playerCount: game.players.length,
      question: question
        ? {
            text: question.text,
            options: question.options,
            correctIndex: question.correctIndex,
            timer: question.timer,
            category: question.category,
            explanation: question.explanation,
          }
        : null,
      durationMs: state.durationMs,
      elapsedMs: state.elapsedMs,
      remainingMs: state.remainingMs,
      paused: state.paused,
      timeUp: state.timeUp,
      answers,
      notAnswered: game.players
        .filter((player) => !answeredIds.has(player.id))
        .map((player) => ({
          playerId: player.id,
          name: player.name,
          online: Boolean(online(player.id)),
        })),
      answerCount: answers.length,
      allAnswered: game.players.length > 0 && answeredIds.size === game.players.length,
      leaderboard: leaderboardFor(game, online),
      projectedLeaderboard: leaderboardFor(game, online, true),
      resultVisible,
      isLastQuestion: game.currentIndex === game.questions.length - 1,
      winner:
        game.status === "finished" && game.winnerId
          ? {
              playerId: game.winnerId,
              name: game.winnerName,
              ...statsForPlayer(game, game.winnerId),
            }
          : null,
    },
  };
}

function projectPlayerState(game, playerId, isOnline) {
  if (!game) return { mode: "closed", serverNow: Date.now(), message: "لا توجد جولة نشطة." };
  const online = makeOnlineFn(isOnline);
  const player = playerById(game, playerId);
  if (!player) return { mode: "closed", serverNow: Date.now(), message: "لم تعد مشاركًا في هذه الجولة." };
  const state = baseState(game, online);
  const mode = displayMode(game);
  const question = game.currentIndex >= 0 ? game.questions[game.currentIndex] : null;
  const answer = game.currentIndex >= 0 ? answerByPlayer(game, game.currentIndex, playerId) : null;
  const stats = statsForPlayer(game, playerId);
  const rankRow = standings(game).find((row) => row.playerId === playerId);
  const revealed = ["revealed", "leaderboard", "podium"].includes(mode);
  const yourResult =
    revealed && question
      ? {
          answered: Boolean(answer),
          correct: Boolean(answer && answer.correct),
          optionIndex: answer ? answer.optionIndex : null,
          optionLabel: answer ? LETTERS[answer.optionIndex] : null,
          points: answer ? answer.points : 0,
          elapsedMs: answer ? answer.elapsedMs : null,
          speedRank: answer && answer.correct ? speedRankFor(game, game.currentIndex, playerId) : 0,
        }
      : null;
  return {
    ...state,
    mode,
    question: question
      ? {
          text: question.text,
          options: question.options,
          timer: question.timer,
          category: question.category,
        }
      : null,
    correctIndex: revealed && question ? question.correctIndex : null,
    explanation: revealed && question ? question.explanation : "",
    yourAnswer:
      mode === "question" && answer
        ? {
            optionIndex: answer.optionIndex,
            optionLabel: LETTERS[answer.optionIndex],
            locked: true,
          }
        : null,
    yourResult,
    you: {
      id: player.id,
      name: player.name,
      online: Boolean(online(player.id)),
      total: stats.total,
      correctCount: stats.correctCount,
      rank: rankRow ? rankRow.rank : game.players.length,
      answersCount: stats.answersCount,
    },
    leaderboard: leaderboardFor(game, online),
    winner:
      game.status === "finished" && game.winnerId
        ? {
            playerId: game.winnerId,
            name: game.winnerName,
            youWon: game.winnerId === playerId,
            ...statsForPlayer(game, game.winnerId),
          }
        : null,
    maxPlayers: game.maxPlayers,
    playerCount: game.players.length,
  };
}

module.exports = {
  projectDisplayState,
  projectAdminState,
  projectPlayerState,
  leaderboardFor,
};
