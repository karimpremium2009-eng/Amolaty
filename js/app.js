(() => {
  "use strict";

  const config = window.AMAL_CONFIG || {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const screens = {
    gate: $("#gate"),
    intro: $("#intro"),
    age: $("#ageMilestone"),
    consent: $("#consentGame"),
    firstQuestion: $("#firstQuestion"),
    heartbeat: $("#heartbeatGame"),
    stars: $("#starsGame"),
    letter: $("#letter"),
    memory: $("#memoryQuestion"),
    candle: $("#candleSection"),
    finalQuestion: $("#finalQuestion"),
    finale: $("#finale")
  };

  const state = {
    currentPin: "",
    transitioning: false,
    runawayAttempts: 0,
    collectedStars: 0,
    heartbeatDone: false,
    heartbeatFrame: null,
    heartbeatStart: 0,
    puzzleSequence: [],
    mirrorReady: false,
    mirrorRevealed: false,
    candleDone: false,
    candleFrame: null,
    candleStart: 0,
    confettiRunning: false,
    orbitIndex: 0,
    ageCelebrated: false,
    ageTimer: null
  };

  function setFeedback(element, message) {
    element.textContent = message;
    element.classList.toggle("has-text", Boolean(message));
  }

  function saveAnswer(key, value) {
    try {
      localStorage.setItem(key, value.trim());
      return true;
    } catch {
      return false;
    }
  }

  function loadAnswer(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }

  function setSession(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // The experience still works when session storage is unavailable.
    }
  }

  function getSession(key) {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function getOrigin(element) {
    if (!element) return { x: innerWidth / 2, y: innerHeight / 2 };
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function activateScreen(target) {
    Object.values(screens).forEach((screen) => {
      screen.classList.remove("active", "scene-enter");
      screen.setAttribute("aria-hidden", "true");
    });
    target.classList.add("active", "scene-enter");
    target.setAttribute("aria-hidden", "false");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    requestAnimationFrame(() => requestAnimationFrame(() => target.classList.remove("scene-enter")));
  }

  async function transitionTo(target, originElement = null) {
    if (state.transitioning || target.classList.contains("active")) return;
    state.transitioning = true;

    const veil = $("#transitionVeil");
    const { x, y } = getOrigin(originElement);
    veil.style.setProperty("--transition-x", `${x}px`);
    veil.style.setProperty("--transition-y", `${y}px`);

    const currentScreen = $(".screen.active");
    if (currentScreen === screens.age && target !== screens.age) {
      clearInterval(state.ageTimer);
      state.ageTimer = null;
    }

    const cover = veil.animate([
      { opacity: 0, transform: "scale(1.03)" },
      { opacity: 1, transform: "scale(1)" }
    ], { duration: 420, easing: "cubic-bezier(.22,.72,.25,1)", fill: "forwards" });
    await cover.finished.catch(() => {});

    activateScreen(target);
    await wait(120);

    const uncover = veil.animate([
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(1.025)" }
    ], { duration: 620, easing: "cubic-bezier(.22,.72,.25,1)", fill: "forwards" });
    await uncover.finished.catch(() => {});

    state.transitioning = false;
    if (target === screens.intro) revealIntro();
    if (target === screens.age) startAgeExperience();
    if (target === screens.letter) startLetterExperience();
    if (target === screens.finale) launchConfetti();
  }

  // Pointer light only on precise pointers, disabling it on phones removes needless work.
  if (matchMedia("(pointer:fine)").matches) {
    let pointerFrame = null;
    addEventListener("pointermove", (event) => {
      if (pointerFrame) return;
      pointerFrame = requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--px", `${event.clientX}px`);
        document.documentElement.style.setProperty("--py", `${event.clientY}px`);
        pointerFrame = null;
      });
    }, { passive: true });
  }

  // Animated sky
  const ambientCanvas = $("#ambientCanvas");
  const ambientCtx = ambientCanvas.getContext("2d");
  let stars = [];
  let shootingStars = [];
  let ambientRatio = 1;
  let lastShoot = 0;

  function resizeAmbient() {
    ambientRatio = Math.min(devicePixelRatio || 1, innerWidth < 720 ? 1 : 1.25);
    ambientCanvas.width = innerWidth * ambientRatio;
    ambientCanvas.height = innerHeight * ambientRatio;
    ambientCanvas.style.width = `${innerWidth}px`;
    ambientCanvas.style.height = `${innerHeight}px`;
    ambientCtx.setTransform(ambientRatio, 0, 0, ambientRatio, 0, 0);

    const count = innerWidth < 720
      ? Math.min(52, Math.max(34, Math.floor(innerWidth / 11)))
      : Math.min(76, Math.max(48, Math.floor(innerWidth / 14)));
    stars = Array.from({ length: count }, (_, index) => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: Math.random() * 1.55 + 0.35,
      speed: (Math.random() * 0.16 + 0.035) * (index % 3 === 0 ? -1 : 1),
      drift: (Math.random() - 0.5) * 0.06,
      alpha: Math.random() * 0.6 + 0.12,
      phase: Math.random() * Math.PI * 2,
      warm: Math.random() > 0.28
    }));
  }

  function createShootingStar() {
    shootingStars.push({
      x: Math.random() * innerWidth * 0.65,
      y: Math.random() * innerHeight * 0.42,
      vx: Math.random() * 4 + 4.2,
      vy: Math.random() * 2 + 1.8,
      life: 0,
      maxLife: 90 + Math.random() * 50
    });
  }

  let lastAmbientFrame = 0;
  function drawAmbient(now = 0) {
    if (document.hidden) {
      requestAnimationFrame(drawAmbient);
      return;
    }
    if (now - lastAmbientFrame < 33) {
      requestAnimationFrame(drawAmbient);
      return;
    }
    lastAmbientFrame = now;
    ambientCtx.clearRect(0, 0, innerWidth, innerHeight);

    for (const star of stars) {
      star.y += star.speed;
      star.x += star.drift;
      star.phase += 0.012;
      if (star.y > innerHeight + 8) star.y = -8;
      if (star.y < -8) star.y = innerHeight + 8;
      if (star.x > innerWidth + 8) star.x = -8;
      if (star.x < -8) star.x = innerWidth + 8;

      const alpha = Math.max(0.06, star.alpha + Math.sin(star.phase) * 0.18);
      ambientCtx.beginPath();
      ambientCtx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ambientCtx.fillStyle = star.warm
        ? `rgba(255,233,186,${alpha})`
        : `rgba(188,190,255,${alpha * 0.72})`;
      ambientCtx.fill();
    }

    if (now - lastShoot > 12000 + Math.random() * 7000 && shootingStars.length === 0) {
      createShootingStar();
      lastShoot = now;
    }

    shootingStars = shootingStars.filter((shot) => shot.life < shot.maxLife);
    for (const shot of shootingStars) {
      shot.x += shot.vx;
      shot.y += shot.vy;
      shot.life += 1;
      const opacity = Math.sin((shot.life / shot.maxLife) * Math.PI) * 0.55;
      const gradient = ambientCtx.createLinearGradient(shot.x - 90, shot.y - 42, shot.x, shot.y);
      gradient.addColorStop(0, "rgba(255,225,175,0)");
      gradient.addColorStop(1, `rgba(255,239,205,${opacity})`);
      ambientCtx.beginPath();
      ambientCtx.moveTo(shot.x - 90, shot.y - 42);
      ambientCtx.lineTo(shot.x, shot.y);
      ambientCtx.strokeStyle = gradient;
      ambientCtx.lineWidth = 1.2;
      ambientCtx.stroke();
    }

    requestAnimationFrame(drawAmbient);
  }

  resizeAmbient();
  requestAnimationFrame(drawAmbient);
  addEventListener("resize", resizeAmbient);

  // Music
  const musicToggle = $("#musicToggle");
  const musicPanel = $("#musicPanel");
  const musicFrame = $("#musicFrame");
  let musicLoaded = false;

  function loadMusic() {
    if (musicLoaded || !config.youtubeVideoId) return;
    const videoId = encodeURIComponent(config.youtubeVideoId);
    const origin = encodeURIComponent(location.origin);
    musicFrame.src = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&mute=0&origin=${origin}`;
    musicLoaded = true;
    musicToggle.classList.remove("hidden");
  }

  function requestMusicPlayback() {
    loadMusic();
    // The fourth PIN tap is a direct user gesture, so ask the embedded player
    // to play with sound immediately and repeat when the track ends.
    try {
      musicFrame.contentWindow?.postMessage(JSON.stringify({
        event: "command",
        func: "playVideo",
        args: []
      }), "*");
      musicFrame.contentWindow?.postMessage(JSON.stringify({
        event: "command",
        func: "unMute",
        args: []
      }), "*");
      musicFrame.contentWindow?.postMessage(JSON.stringify({
        event: "command",
        func: "setLoop",
        args: [true]
      }), "*");
    } catch (_) {
      // The autoplay query remains as the fallback.
    }
  }

  musicToggle.addEventListener("click", () => {
    if (!musicLoaded) loadMusic();
    musicPanel.classList.toggle("hidden");
  });
  $("#closeMusicPanel").addEventListener("click", () => musicPanel.classList.add("hidden"));

  // PIN keypad
  const pinDisplay = $("#pinDisplay");
  const pinCells = $$("span", pinDisplay);
  const pinFeedback = $("#pinFeedback");
  const gateBloom = $("#gateBloom");

  function renderPin() {
    pinCells.forEach((cell, index) => cell.classList.toggle("filled", index < state.currentPin.length));
  }

  async function validatePin() {
    if (state.currentPin.length !== 4) return;
    await wait(420);

    if (state.currentPin === String(config.password || "")) {
      pinDisplay.classList.add("success");
      setFeedback(pinFeedback, "تم التعرّف على أمولتي، افتحي قلبكِ قليلًا ✦");
      gateBloom.classList.add("open");
      setSession("amal_unlocked", "1");
      musicToggle.classList.remove("hidden");
      requestMusicPlayback();
      setTimeout(requestMusicPlayback, 700);
      setTimeout(requestMusicPlayback, 1700);
      await wait(2050);
      transitionTo(screens.intro, pinDisplay);
      return;
    }

    pinDisplay.classList.add("error");
    setFeedback(pinFeedback, "ليست هي، يبدو أنكِ ستعودين إلى كريم مرة أخرى 🌝");
    await wait(1250);
    pinDisplay.classList.remove("error");
    state.currentPin = "";
    renderPin();
  }

  function handlePinKey(key) {
    if (state.transitioning || pinDisplay.classList.contains("success")) return;
    if (key === "clear") {
      state.currentPin = "";
      setFeedback(pinFeedback, "");
    } else if (key === "delete") {
      state.currentPin = state.currentPin.slice(0, -1);
    } else if (/^\d$/.test(key) && state.currentPin.length < 4) {
      state.currentPin += key;
    }
    renderPin();
    if (state.currentPin.length === 4) {
      // Start the music synchronously inside the final keypad click.
      // Waiting before doing this would make mobile browsers treat it as autoplay.
      if (state.currentPin === String(config.password || "")) requestMusicPlayback();
      validatePin();
    }
  }

  $("#pinKeypad").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-key]");
    if (!button) return;
    button.animate([
      { transform: "scale(1)" },
      { transform: "scale(.9)" },
      { transform: "scale(1.04)" },
      { transform: "scale(1)" }
    ], { duration: 430, easing: "cubic-bezier(.2,.75,.25,1)" });
    handlePinKey(button.dataset.key);
  });

  addEventListener("keydown", (event) => {
    if (!screens.gate.classList.contains("active")) return;
    if (/^\d$/.test(event.key)) handlePinKey(event.key);
    if (event.key === "Backspace") handlePinKey("delete");
    if (event.key === "Escape") handlePinKey("clear");
  });

  function revealIntro() {
    $$(".cinematic-line", screens.intro).forEach((element, index) => {
      setTimeout(() => element.classList.add("show"), 500 + index * 720);
    });
  }

  if (getSession("amal_unlocked") === "1") {
    activateScreen(screens.intro);
    musicToggle.classList.remove("hidden");
    setTimeout(revealIntro, 100);
  }

  $("#startJourney").addEventListener("click", (event) => transitionTo(screens.age, event.currentTarget));

  // Eighteen-year milestone and live life counter
  const daysAlive = $("#daysAlive");
  const minutesAlive = $("#minutesAlive");
  const ageStatus = $("#ageStatus");
  const ageNumberButton = $("#ageNumberButton");
  const ageSparks = $("#ageSparks");

  function localDateFromParts(parts, fallback) {
    const value = parts || fallback;
    return new Date(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour || 0),
      Number(value.minute || 0),
      0,
      0
    );
  }

  const birthMoment = localDateFromParts(config.birthDate, { year: 2008, month: 7, day: 30 });
  const eighteenthMoment = localDateFromParts(config.eighteenthBirthday, { year: 2026, month: 7, day: 30 });

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
  }

  function updateAgeCounter() {
    const now = new Date();
    const elapsed = Math.max(0, now.getTime() - birthMoment.getTime());
    const days = Math.floor(elapsed / 86400000);
    const minutes = Math.floor(elapsed / 60000);
    daysAlive.textContent = formatNumber(days);
    minutesAlive.textContent = formatNumber(minutes);

    const remaining = eighteenthMoment.getTime() - now.getTime();
    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600000);
      const minutesLeft = Math.floor((remaining % 3600000) / 60000);
      const secondsLeft = Math.floor((remaining % 60000) / 1000);
      ageStatus.textContent = `بقي ${formatNumber(hours)} ساعة و${formatNumber(minutesLeft)} دقيقة و${formatNumber(secondsLeft)} ثانية لتكملي 18 سنة`;
    } else {
      ageStatus.textContent = "اليوم أكملتِ 18 سنة، وكل سنة منها أوصلتكِ إلى هذه اللحظة";
    }
  }

  function buildAgeSparks() {
    if (ageSparks.childElementCount) return;
    for (let index = 0; index < 18; index += 1) {
      const spark = document.createElement("i");
      spark.style.setProperty("--spark-index", index);
      spark.style.setProperty("--spark-angle", `${index * 20}deg`);
      ageSparks.appendChild(spark);
    }
  }

  function startAgeExperience() {
    buildAgeSparks();
    updateAgeCounter();
    clearInterval(state.ageTimer);
    state.ageTimer = setInterval(updateAgeCounter, 1000);
  }

  ageNumberButton.addEventListener("click", () => {
    state.ageCelebrated = true;
    ageNumberButton.classList.remove("celebrate");
    void ageNumberButton.offsetWidth;
    ageNumberButton.classList.add("celebrate");
  });

  $("#continueFromAge").addEventListener("click", (event) => transitionTo(screens.consent, event.currentTarget));

  // Runaway button
  const runawayArea = $("#runawayArea");
  const noAskButton = $("#noAskButton");
  const runawayMessage = $("#runawayMessage");

  function moveRunawayButton() {
    state.runawayAttempts += 1;
    const areaRect = runawayArea.getBoundingClientRect();
    const buttonRect = noAskButton.getBoundingClientRect();
    const maxX = Math.max(12, areaRect.width - buttonRect.width - 20);
    const maxY = Math.max(12, areaRect.height - buttonRect.height - 20);
    noAskButton.style.position = "absolute";
    noAskButton.style.left = `${12 + Math.random() * (maxX - 12)}px`;
    noAskButton.style.top = `${12 + Math.random() * (maxY - 12)}px`;
    noAskButton.animate([
      { transform: "scale(1) rotate(0deg)" },
      { transform: "scale(.82) rotate(-7deg)" },
      { transform: "scale(1.06) rotate(5deg)" },
      { transform: "scale(1) rotate(0deg)" }
    ], { duration: 720, easing: "cubic-bezier(.2,.75,.25,1)" });

    const messages = [
      "هههههههه، ليس بهذه السهولة 🌝",
      "اقتربتِ، لكنه قرر الهرب",
      "واضح أن هذا الزر خجول أكثر من اللازم 😂",
      "خلاص يا أمولتي، اضغطي على نعم"
    ];
    setFeedback(runawayMessage, messages[Math.min(state.runawayAttempts - 1, messages.length - 1)]);
  }

  if (matchMedia("(pointer:fine)").matches) {
    noAskButton.addEventListener("pointerenter", moveRunawayButton);
  }
  noAskButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    moveRunawayButton();
  });

  $("#yesAskButton").addEventListener("click", (event) => transitionTo(screens.firstQuestion, event.currentTarget));

  // First answer
  const loveAnswer = $("#loveAnswer");
  loveAnswer.value = loadAnswer("amal_love_answer");
  $("#saveLoveAnswer").addEventListener("click", async (event) => {
    const value = loveAnswer.value.trim();
    if (value.length < 3) {
      setFeedback($("#loveAnswerFeedback"), "أريد جوابًا حقيقيًا، حتى لو كان قصيرًا 🤍");
      loveAnswer.focus();
      return;
    }
    saveAnswer("amal_love_answer", value);
    setFeedback($("#loveAnswerFeedback"), "حفظت جوابكِ بهدوء، وسيصل إلى كريم في نهاية الرحلة 🤍");
    await wait(3200);
    transitionTo(screens.heartbeat, event.currentTarget);
  });

  // Heartbeat hold
  const heartHold = $("#heartHold");
  const syncFill = $("#syncMeterFill");
  const heartbeatFeedback = $("#heartbeatFeedback");
  const HEARTBEAT_DURATION = 3600;

  function startHeartbeatHold(event) {
    event.preventDefault();
    if (state.heartbeatDone) return;
    heartHold.classList.add("syncing");
    state.heartbeatStart = performance.now();
    setFeedback(heartbeatFeedback, "جاري البحث عن نبضة كريم");
    cancelAnimationFrame(state.heartbeatFrame);

    const tick = (now) => {
      const progress = Math.min(1, (now - state.heartbeatStart) / HEARTBEAT_DURATION);
      syncFill.style.width = `${progress * 100}%`;
      if (progress >= 1) {
        completeHeartbeat();
        return;
      }
      state.heartbeatFrame = requestAnimationFrame(tick);
    };
    state.heartbeatFrame = requestAnimationFrame(tick);
  }

  function cancelHeartbeatHold() {
    if (state.heartbeatDone) return;
    cancelAnimationFrame(state.heartbeatFrame);
    heartHold.classList.remove("syncing");
    syncFill.style.width = "0%";
    setFeedback(heartbeatFeedback, "لا ترفعي إصبعكِ بسرعة، النبض يحتاج قليلًا من الصبر 🌝");
  }

  async function completeHeartbeat() {
    state.heartbeatDone = true;
    cancelAnimationFrame(state.heartbeatFrame);
    syncFill.style.width = "100%";
    setFeedback(heartbeatFeedback, "تمت مزامنة نبضتين بنجاح، النتيجة غير علمية لكنها صحيحة جدًا 🌝🤍");
    heartHold.animate([
      { transform: "scale(1)" },
      { transform: "scale(1.18)" },
      { transform: "scale(.96)" },
      { transform: "scale(1.08)" },
      { transform: "scale(1)" }
    ], { duration: 1600, easing: "cubic-bezier(.2,.75,.25,1)" });
    await wait(2300);
    $("#continueToStars").classList.remove("hidden");
  }

  heartHold.addEventListener("pointerdown", startHeartbeatHold);
  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => heartHold.addEventListener(eventName, cancelHeartbeatHold));
  $("#continueToStars").addEventListener("click", (event) => transitionTo(screens.stars, event.currentTarget));

  // Stars game
  const starButtons = $$(".collect-star");
  const collectedLabels = $("#collectedLabels");
  const starsCounter = $("#starsCounter");
  const enterLetter = $("#enterLetter");

  starButtons.forEach((star) => {
    star.addEventListener("click", async () => {
      if (star.classList.contains("collected")) return;
      star.classList.add("collected");
      state.collectedStars += 1;

      await wait(650);
      const label = document.createElement("span");
      label.textContent = star.dataset.label;
      collectedLabels.appendChild(label);
      starsCounter.textContent = `${state.collectedStars} من 5`;

      if (state.collectedStars === starButtons.length) {
        await wait(1800);
        starsCounter.textContent = "خمس نجوم فقط، لأن البقية لم تتسع لها السماء 🌝";
        await wait(1500);
        enterLetter.classList.remove("hidden");
      }
    });
  });

  enterLetter.addEventListener("click", (event) => transitionTo(screens.letter, event.currentTarget));

  // Letter reveal
  let letterObserverStarted = false;
  function startLetterExperience() {
    if (!letterObserverStarted) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("visible");
        });
      }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
      $$(".reveal-on-scroll", screens.letter).forEach((element) => observer.observe(element));
      letterObserverStarted = true;
    }

    setupMirror();
    addEventListener("scroll", updateLetterProgress, { passive: true });
    updateLetterProgress();
  }

  function updateLetterProgress() {
    if (!screens.letter.classList.contains("active")) return;
    const article = $(".living-letter");
    const rect = article.getBoundingClientRect();
    const total = article.offsetHeight - innerHeight;
    const progressed = Math.min(total, Math.max(0, -rect.top));
    $("#letterProgressBar").style.width = `${total > 0 ? (progressed / total) * 100 : 0}%`;
  }

  // Scratch mirror
  function setupMirror() {
    if (state.mirrorReady) return;
    state.mirrorReady = true;
    const canvas = $("#mirrorCanvas");
    const frame = $(".mirror-frame");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let drawing = false;
    let scratchCount = 0;

    function sizeCanvas() {
      const rect = frame.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio || 1, innerWidth < 720 ? 1 : 1.25);
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const gradient = ctx.createLinearGradient(0, 0, rect.width, rect.height);
      gradient.addColorStop(0, "rgba(226,220,226,.98)");
      gradient.addColorStop(.45, "rgba(139,122,137,.98)");
      gradient.addColorStop(1, "rgba(76,65,79,.98)");
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = "rgba(255,255,255,.23)";
      for (let i = 0; i < 65; i += 1) {
        ctx.beginPath();
        ctx.arc(Math.random() * rect.width, Math.random() * rect.height, Math.random() * 2 + .4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,.76)";
      ctx.font = "600 16px Noto Kufi Arabic";
      ctx.textAlign = "center";
      ctx.fillText("امسحي الضباب", rect.width / 2, rect.height / 2);
    }

    function scratch(event) {
      if (!drawing || state.mirrorRevealed) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      ctx.globalCompositeOperation = "destination-out";
      const brush = ctx.createRadialGradient(x, y, 5, x, y, 38);
      brush.addColorStop(0, "rgba(0,0,0,1)");
      brush.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = brush;
      ctx.beginPath();
      ctx.arc(x, y, 42, 0, Math.PI * 2);
      ctx.fill();
      scratchCount += 1;
      if (scratchCount > 42) revealMirror();
    }

    function revealMirror() {
      if (state.mirrorRevealed) return;
      state.mirrorRevealed = true;
      $("#mirrorHint").textContent = "هذه هي الصورة التي أتمنى أن تري بها نفسكِ دائمًا";
      canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1900, easing: "ease", fill: "forwards" });
    }

    canvas.addEventListener("pointerdown", (event) => {
      drawing = true;
      canvas.setPointerCapture?.(event.pointerId);
      scratch(event);
    });
    canvas.addEventListener("pointermove", scratch);
    canvas.addEventListener("pointerup", () => { drawing = false; });
    canvas.addEventListener("pointercancel", () => { drawing = false; });
    sizeCanvas();
    addEventListener("resize", () => {
      if (!state.mirrorRevealed) sizeCanvas();
    });
  }

  // Thailand rename
  $("#renamePlaceButton").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.classList.remove("clicked");
    void button.offsetWidth;
    button.classList.add("clicked");
    setFeedback($("#renameFeedback"), "تم اعتماد تايلاند مؤقتًا، في انتظار موافقة أمولتي والبلدية 🌝");
  });

  // Relationship orbit
  const orbitNodes = $$(".orbit-node");
  const orbitCenterText = $("#orbitCenterText");
  let orbitTimer = null;

  function setOrbitStep(index) {
    state.orbitIndex = (index + orbitNodes.length) % orbitNodes.length;
    orbitNodes.forEach((node, i) => node.classList.toggle("active", i === state.orbitIndex));
    orbitCenterText.classList.add("changing");
    setTimeout(() => {
      orbitCenterText.textContent = orbitNodes[state.orbitIndex].dataset.step;
      orbitCenterText.classList.remove("changing");
    }, 360);
  }

  orbitNodes.forEach((node, index) => node.addEventListener("click", () => {
    setOrbitStep(index);
    clearInterval(orbitTimer);
    orbitTimer = setInterval(() => setOrbitStep(state.orbitIndex + 1), 2700);
  }));
  orbitTimer = setInterval(() => setOrbitStep(state.orbitIndex + 1), 2700);

  // Floating name puzzle
  const correctPuzzle = ["أ", "م", "ا", "ل"];
  const answerSlots = $$(".answer-slots span");
  const puzzleFeedback = $("#puzzleFeedback");
  const letterTiles = $$(".letter-tile");

  function resetPuzzle() {
    state.puzzleSequence = [];
    answerSlots.forEach((slot) => {
      slot.textContent = "";
      slot.classList.remove("filled");
    });
    letterTiles.forEach((tile) => tile.classList.remove("used"));
  }

  letterTiles.forEach((tile) => {
    tile.addEventListener("click", async () => {
      if (tile.classList.contains("used")) return;
      const expected = correctPuzzle[state.puzzleSequence.length];
      if (tile.dataset.letter !== expected) {
        tile.classList.remove("wrong");
        void tile.offsetWidth;
        tile.classList.add("wrong");
        setFeedback(puzzleFeedback, "الحرف هرب من مكانه الصحيح، جربي من جديد 🌝");
        await wait(1200);
        resetPuzzle();
        return;
      }

      const index = state.puzzleSequence.length;
      state.puzzleSequence.push(tile.dataset.letter);
      tile.classList.add("used");
      answerSlots[index].textContent = tile.dataset.letter;
      answerSlots[index].classList.add("filled");
      setFeedback(puzzleFeedback, state.puzzleSequence.join(" "));

      if (state.puzzleSequence.length === correctPuzzle.length) {
        await wait(900);
        setFeedback(puzzleFeedback, "أحسنتِ، مع أنني لا أفهم كيف يمكن لاسم أمال أن يضيع مني أصلًا 🤍");
        answerSlots.forEach((slot, slotIndex) => {
          slot.animate([
            { transform: "translateY(-5px) rotate(0deg)" },
            { transform: `translateY(-16px) rotate(${slotIndex % 2 ? 6 : -6}deg)` },
            { transform: "translateY(-5px) rotate(0deg)" }
          ], { duration: 1100, delay: slotIndex * 130, easing: "cubic-bezier(.2,.75,.25,1)" });
        });
      }
    });
  });

  $("#continueToMemory").addEventListener("click", (event) => transitionTo(screens.memory, event.currentTarget));

  // Memory answer
  const memoryAnswer = $("#memoryAnswer");
  memoryAnswer.value = loadAnswer("amal_memory_answer");
  $("#saveMemoryAnswer").addEventListener("click", async (event) => {
    const value = memoryAnswer.value.trim();
    if (value.length < 3) {
      setFeedback($("#memoryFeedback"), "اكتبي ذكرى صغيرة حقيقية، حتى لو كانت في سطر واحد 🤍");
      memoryAnswer.focus();
      return;
    }
    saveAnswer("amal_memory_answer", value);
    setFeedback($("#memoryFeedback"), "حفظت الذكرى، وربما سيتظاهر كريم بأنه كان يتذكرها كلها 🌝");
    await wait(3400);
    transitionTo(screens.candle, event.currentTarget);
  });

  // Candle
  const flameButton = $("#flameButton");
  const flame = $(".flame", flameButton);
  const flameAura = $(".flame-aura", flameButton);
  const holdMeterFill = $("#holdMeterFill");
  const candleFeedback = $("#candleFeedback");
  const CANDLE_DURATION = 4800;

  function startCandleHold(event) {
    event.preventDefault();
    if (state.candleDone) return;
    flameButton.classList.add("holding");
    state.candleStart = performance.now();
    setFeedback(candleFeedback, "خذي وقتكِ، الأمنية الجميلة لا تحتاج إلى استعجال");
    cancelAnimationFrame(state.candleFrame);

    const tick = (now) => {
      const progress = Math.min(1, (now - state.candleStart) / CANDLE_DURATION);
      holdMeterFill.style.width = `${progress * 100}%`;
      if (progress >= 1) {
        completeCandle();
        return;
      }
      state.candleFrame = requestAnimationFrame(tick);
    };
    state.candleFrame = requestAnimationFrame(tick);
  }

  function cancelCandleHold() {
    if (state.candleDone) return;
    cancelAnimationFrame(state.candleFrame);
    flameButton.classList.remove("holding");
    holdMeterFill.style.width = "0%";
    setFeedback(candleFeedback, "لم تنتهِ الأمنية بعد، اضغطي مطولًا مرة أخرى 🌝");
  }

  async function completeCandle() {
    state.candleDone = true;
    cancelAnimationFrame(state.candleFrame);
    flameButton.classList.remove("holding");
    holdMeterFill.style.width = "100%";
    flame.classList.add("extinguished");
    flameAura.classList.add("extinguished");
    setFeedback(candleFeedback, "أتمنى من قلبي أن تتحقق أمنيتكِ يا أمولتي 🤍");
    await wait(3600);
    transitionTo(screens.finalQuestion, flameButton);
  }

  flameButton.addEventListener("pointerdown", startCandleHold);
  ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => flameButton.addEventListener(eventName, cancelCandleHold));

  // Final answer
  const finalAnswer = $("#finalAnswer");
  finalAnswer.value = loadAnswer("amal_final_answer");
  $("#saveFinalAnswer").addEventListener("click", async (event) => {
    const value = finalAnswer.value.trim();
    if (value.length < 2) {
      setFeedback($("#finalAnswerFeedback"), "حتى كلمة واحدة من قلبكِ تكفي 🤍");
      finalAnswer.focus();
      return;
    }
    saveAnswer("amal_final_answer", value);
    setFeedback($("#finalAnswerFeedback"), "وصلت كلماتكِ إلى آخر صفحة، لكنها لن تضيع");
    await wait(3400);
    transitionTo(screens.finale, event.currentTarget);
  });

  // WhatsApp bundle
  $("#sendWhatsApp").addEventListener("click", () => {
    const number = String(config.whatsappNumber || "").replace(/\D/g, "");
    if (!/^212[5-7]\d{8}$/.test(number)) {
      setFeedback($("#whatsappFeedback"), "رقم واتساب كريم يحتاج إلى تعديل داخل config.js");
      return;
    }

    const message = [
      "رسالة من أمال بعد إنهاء مفاجأة عيد ميلادها 🎂🤍",
      "",
      "1) ما الشيء الذي يفعله كريم ويجعلني أشعر بأنه يحبني فعلًا",
      loadAnswer("amal_love_answer") || "لم أكتب جوابًا",
      "",
      "2) ذكرى صغيرة بيننا أحتفظ بها",
      loadAnswer("amal_memory_answer") || "لم أكتب جوابًا",
      "",
      "3) أول شيء أريد قوله لكريم بعد نهاية الرحلة",
      loadAnswer("amal_final_answer") || "لم أكتب جوابًا",
      "",
      "وصلت إلى نهاية رسالتك يا كريم 🤍"
    ].join("\n");

    location.href = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  });

  const waitButton = $("#waitButton");
  let waitAttempts = 0;
  waitButton.addEventListener("pointerenter", () => {
    waitAttempts += 1;
    if (waitAttempts > 4) {
      waitButton.textContent = "حسنًا، سأرسلها 😂";
      waitButton.style.transform = "none";
      return;
    }
    const x = Math.round((Math.random() - .5) * Math.min(280, innerWidth * .5));
    const y = Math.round((Math.random() - .5) * 110);
    waitButton.style.transform = `translate(${x}px,${y}px)`;
  });
  waitButton.addEventListener("click", () => {
    waitButton.textContent = "كفاكِ تعذيبًا له، اضغطي الزر الأخضر 🌝";
    waitButton.style.transform = "none";
  });

  // Confetti and floating hearts
  const confettiCanvas = $("#confettiCanvas");
  const confettiCtx = confettiCanvas.getContext("2d");
  let confettiPieces = [];

  function resizeConfetti() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    confettiCanvas.width = innerWidth * ratio;
    confettiCanvas.height = innerHeight * ratio;
    confettiCanvas.style.width = `${innerWidth}px`;
    confettiCanvas.style.height = `${innerHeight}px`;
    confettiCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function launchConfetti() {
    resizeConfetti();
    const confettiCount = innerWidth < 720 ? 105 : 145;
    confettiPieces = Array.from({ length: confettiCount }, (_, index) => ({
      x: Math.random() * innerWidth,
      y: -30 - Math.random() * innerHeight * .75,
      w: Math.random() * 7 + 3,
      h: Math.random() * 15 + 7,
      vy: Math.random() * 1.8 + .75,
      vx: (Math.random() - .5) * 1.1,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - .5) * .1,
      alpha: Math.random() * .45 + .45,
      heart: index % 19 === 0,
      warm: Math.random() > .42
    }));
    state.confettiRunning = true;
    drawConfetti();
  }

  function drawConfetti() {
    if (!state.confettiRunning) return;
    confettiCtx.clearRect(0, 0, innerWidth, innerHeight);
    let alive = 0;

    for (const piece of confettiPieces) {
      piece.x += piece.vx + Math.sin(piece.y * .01) * .25;
      piece.y += piece.vy;
      piece.rot += piece.spin;
      if (piece.y < innerHeight + 50) alive += 1;
      confettiCtx.save();
      confettiCtx.translate(piece.x, piece.y);
      confettiCtx.rotate(piece.rot);
      confettiCtx.globalAlpha = piece.alpha;
      confettiCtx.fillStyle = piece.warm ? "rgb(245,213,154)" : "rgb(184,79,114)";
      if (piece.heart) {
        confettiCtx.font = "18px serif";
        confettiCtx.fillText("♥", 0, 0);
      } else {
        confettiCtx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      }
      confettiCtx.restore();
    }

    if (alive > 0) requestAnimationFrame(drawConfetti);
    else {
      state.confettiRunning = false;
      confettiCtx.clearRect(0, 0, innerWidth, innerHeight);
    }
  }

  addEventListener("resize", resizeConfetti);
})();
