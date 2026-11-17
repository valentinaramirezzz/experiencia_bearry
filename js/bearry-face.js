const stage = document.querySelector('.stage');
const video = document.querySelector('#video-renderer');
const cameraButton = document.querySelector('#camera');
const soundButton = document.querySelector('#sound');
const testSoundButton = document.querySelector('#test-sound');
const audioStatus = document.querySelector('#audio-status');
const modeButtons = document.querySelectorAll('[data-mode]');
const status = document.querySelector('#status');
const modes = {
    smile: ['¡Sonríe!', 'Aparecerá rubor en tus mejillas.', .46, .36],
    frown: ['¡Frunce el ceño!', 'Aparecerán una marca de enfado y humo.', .20, .16],
    kiss: ['¡Lanza un beso!', 'Saldrán corazones de tus labios.', .49, .38],
};

let mode = 'smile';
let session;
let audio;
let audioOutput;
let muted = false;
let kissSound;
let pendingFrown = null;
let active = false;
let since = 0;
let face = null;
let lastDetection = 0;
let scores = [];
let statusText = '';

function setStatus(message) {
    if (statusText === message) return;
    statusText = message;
    status.textContent = message;
}

function particle(type, symbol = '') {
    const node = document.createElement('span');
    node.className = 'particle ' + type;
    node.textContent = symbol;
    document.querySelector('#effects').append(node);
    return node;
}

const cheeks = [particle('blush'), particle('blush')];
cheeks[0].classList.add('blush-right');
const anger = particle('anger', '💢︎');
const smoke = Array.from({length: 6}, () => particle('smoke'));
const hearts = Array.from({length: 7}, () => particle('heart'));
const particles = [...cheeks, anger, ...smoke, ...hearts];

function updateSoundButton() {
    const ready = !muted && audio?.state === 'running';
    soundButton.setAttribute('aria-pressed', String(ready));
    soundButton.textContent = muted ? 'Sin sonido' : ready ? 'Sonido activo' : 'Activar sonido';
}

function loadKissSound() {
    kissSound ??= fetch(new URL('../assets/audio/sonido-beso.mp3', import.meta.url))
        .then(response => {
            if (!response.ok) throw new Error('No se pudo cargar el sonido de beso.');
            return response.arrayBuffer();
        })
        .then(bytes => audio.decodeAudioData(bytes))
        .catch(error => {
            console.warn(error);
            kissSound = undefined;
            return null;
        });
    return kissSound;
}

function playNotes(selected) {
    const notes = { smile: [523, 659, 784], frown: [230, 160], kiss: [660, 990] };
    for (const [index, note] of notes[selected].entries()) {
        const start = audio.currentTime + index * .065;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = selected === 'frown' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(note, start);
        if (selected === 'frown') oscillator.frequency.exponentialRampToValueAtTime(note * .7, start + .16);
        gain.gain.setValueAtTime(.001, start);
        gain.gain.exponentialRampToValueAtTime(.24, start + .018);
        gain.gain.exponentialRampToValueAtTime(.001, start + .19);
        oscillator.connect(gain).connect(audioOutput);
        oscillator.start(start);
        oscillator.stop(start + .2);
    }
}

async function sound() {
    if (!audio || muted) return;
    const selected = mode;
    const current = session;
    const trigger = since;
    const requestedAt = performance.now();
    if (audio.state !== 'running') {
        await audio.resume().catch(console.warn);
    }
    const buffer = selected === 'kiss' ? await loadKissSound() : null;
    if (muted || session !== current || mode !== selected || since !== trigger ||
        audio.state !== 'running' || performance.now() - requestedAt > 1500) return;

    if (!buffer) {
        playNotes(selected);
        return;
    }

    const source = audio.createBufferSource();
    const volume = audio.createGain();
    volume.gain.value = 1.65;
    source.buffer = buffer;
    source.connect(volume).connect(audioOutput);
    source.onended = () => {
        source.disconnect();
        volume.disconnect();
    };
    source.start();
}

function unlockAudio() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || muted) return Promise.resolve(false);
    if (!audio) {
        audio = new Audio();
        audioOutput = audio.createGain();
        const limiter = audio.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.ratio.value = 12;
        limiter.attack.value = .002;
        audioOutput.connect(limiter).connect(audio.destination);
        audio.addEventListener('statechange', updateSoundButton);
    }
    loadKissSound();
    return audio.resume().then(() => {
        updateSoundButton();
        return audio.state === 'running';
    }).catch(error => {
        console.warn(error);
        return false;
    });
}

function setMuted(value) {
    muted = value;
    if (audioOutput) audioOutput.gain.value = muted ? 0 : 1;
    updateSoundButton();
}

function showAudioStatus(message) {
    audioStatus.textContent = message;
    audioStatus.hidden = !message;
}

async function testAudio() {
    setMuted(false);
    showAudioStatus('Iniciando la prueba…');
    const ready = await Promise.race([
        unlockAudio(),
        new Promise(resolve => setTimeout(() => resolve(false), 1800)),
    ]);
    if (muted) return;
    if (ready) playNotes('smile');
    showAudioStatus(ready ? 'Si oyes las tres notas, el audio está activo.' :
        'El navegador no inició el audio. Toca Probar audio para reintentar.');
}

soundButton.addEventListener('click', () => {
    if (!muted && audio?.state === 'running') {
        setMuted(true);
        showAudioStatus('');
    } else {
        testAudio();
    }
});

testSoundButton.addEventListener('click', testAudio);

for (const button of modeButtons) {
    button.addEventListener('click', () => {
        unlockAudio();
        if (mode === button.dataset.mode) return;
        mode = button.dataset.mode;
        active = false;
        pendingFrown = null;
        since = 0;
        const [prompt, hint] = modes[mode];
        document.querySelector('#prompt').textContent = prompt;
        document.querySelector('#hint').textContent = hint;
        for (const option of modeButtons) {
            option.setAttribute('aria-pressed', String(option === button));
        }
    });
}

function gestureScore() {
    const value = name => scores.find(item => item.categoryName === name)?.score ?? 0;
    if (mode === 'kiss') return value('mouthPucker') * (1 - value('jawOpen'));
    const prefix = mode === 'smile' ? 'mouthSmile' : 'browDown';
    const left = value(prefix + 'Left');
    const right = value(prefix + 'Right');
    if (mode === 'frown') return .6 * Math.max(left, right) + .4 * Math.min(left, right);
    return (left + right) / 2;
}

function draw(node, x, y, width, height, opacity, angle = 0) {
    node.style.width = width + 'px';
    node.style.height = height + 'px';
    node.style.fontSize = height + 'px';
    node.style.opacity = opacity;
    node.style.transform = `translate(${x - width / 2}px, ${y - height / 2}px) rotate(${angle}rad)`;
}

function renderEffects(point, size, elapsed) {
    if (mode === 'smile' && active) {
        const opacity = Math.min(elapsed / .16, 1);
        const right = point(50);
        const left = point(280);
        const tilt = Math.atan2(right.y - left.y, right.x - left.x);
        for (const [i, { x, y }] of [right, left].entries()) {
            draw(cheeks[i], x, y, size * .31, size * .30, opacity, tilt);
        }
    }
    if (mode === 'frown' && (active || elapsed < 1.2)) {
        const head = point(10);
        draw(anger, head.x, head.y + size * .14, size * .34, size * .34, active ? 1 : Math.max(0, 1 - elapsed / .9));
        for (const [i, puff] of smoke.entries()) {
            const phase = (elapsed * 1.25 + i * .23) % 1;
            const side = i % 2 === 0 ? 1 : -1;
            const temple = point(side === 1 ? 127 : 356);
            draw(puff, temple.x + side * size * (.09 + phase * .25),
                temple.y - size * phase * .56, size * (.16 + phase * .28),
                size * (.16 + phase * .28), Math.sin(phase * Math.PI) * Math.max(0, active ? 1 : 1 - elapsed / 1.2));
        }
    }
    if (mode === 'kiss' && elapsed < 1.3) {
        const lips = point(13);
        for (const [i, heart] of hearts.entries()) {
            const progress = (elapsed - i * .06) / .92;
            if (progress <= 0 || progress >= 1) continue;
            const spread = (i - 3) * .19;
            const diameter = size * (.23 + (i % 3) * .065);
            draw(heart, lips.x + size * spread * (.25 + progress), lips.y - size * progress * (.55 + (i % 3) * .14),
                diameter, diameter, Math.min(progress * 9, 1) * (1 - progress), spread * progress);
        }
    }
}

function frame(current, now) {
    if (session !== current) return;
    try {
        if (now - lastDetection >= 45 && video.readyState >= 2) {
            lastDetection = now;
            if (current.tracker.update()) {
                face = current.tracker.getLandmarks();
                scores = current.tracker.getBlendShapes();
                if (!face) {
                    active = false;
                    pendingFrown = null;
                    since = 0;
                } else {
                    const [, , high, low] = modes[mode];
                    const aboveThreshold = gestureScore() >= (active ? low : high);
                    let detected = aboveThreshold;
                    if (mode === 'frown') {
                        pendingFrown = aboveThreshold ? (pendingFrown ?? now) : null;
                        detected = aboveThreshold && (active || now - pendingFrown >= 110);
                    }
                    if (detected && !active) {
                        since = now;
                        sound();
                    }
                    active = detected;
                }
            }
        }

        if (current.fruitRain) {
            try {
                current.fruitRain.draw(now);
            } catch (error) {
                console.warn('No se pudo dibujar la lluvia de frutas.', error);
                current.fruitRain.dispose();
                current.fruitRain = null;
            }
        }
        for (const item of particles) item.style.opacity = 0;
        setStatus(face ? '' : 'Coloca tu rostro dentro de la cámara.');
        if (face) {
            const width = stage.clientWidth;
            const height = stage.clientHeight;
            const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
            const vw = video.videoWidth * scale;
            const vh = video.videoHeight * scale;
            const point = id => ({
                x: (1 - face[id].x) * vw + (width - vw) / 2,
                y: face[id].y * vh + (height - vh) / 2,
            });
            current.ears.draw(point, width, height, current.tracker.getHeadMatrix());
            const left = point(234);
            const right = point(454);
            const faceWidth = Math.hypot(left.x - right.x, left.y - right.y);
            if (since) renderEffects(point, faceWidth, (now - since) / 1000);
        } else {
            current.ears.clear();
        }
        current.frame = requestAnimationFrame(time => frame(current, time));
    } catch (error) {
        console.error(error);
        stop('Se interrumpió el seguimiento. Puedes volver a activar la cámara.');
    }
}

function stop(message = 'Activa la cámara para probar el filtro.') {
    const current = session;
    session = null;
    if (current) {
        cancelAnimationFrame(current.frame);
        current.stream?.getTracks().forEach(track => track.stop());
        current.tracker?.landmarker?.close();
        current.ears?.dispose();
        current.fruitRain?.dispose();
    }
    video.srcObject = null;
    face = null;
    pendingFrown = null;
    active = false;
    since = 0;
    lastDetection = 0;
    for (const item of particles) item.style.opacity = 0;
    stage.classList.remove('active');
    cameraButton.disabled = false;
    cameraButton.textContent = 'Activar cámara';
    setStatus(message);
}

async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('Abre esta página con HTTPS o en localhost para usar la cámara.');
        return;
    }
    const current = {};
    session = current;
    cameraButton.disabled = true;
    setStatus('Preparando cámara y filtro…');
    unlockAudio();
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
            audio: false,
        });
        if (session !== current) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }
        current.stream = stream;
        for (const track of stream.getVideoTracks()) {
            track.addEventListener('ended', () => {
                if (session === current) stop('La cámara se desconectó.');
            });
        }
        video.srcObject = stream;
        await video.play();
        const [{ default: MPFaceTracker }, { createEars }] = await Promise.all([
            import('./mediapipe/mp_face_tracker.js'),
            import('./bearry-ears.js'),
        ]);
        if (session !== current) return;
        const tracker = new MPFaceTracker(video);
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        const [tracking, ears] = await Promise.allSettled([tracker.init(), createEars(canvas)]);
        if (session !== current) {
            tracker.landmarker?.close();
            if (ears.status === 'fulfilled') ears.value.dispose();
            return;
        }
        current.tracker = tracker;
        if (ears.status === 'fulfilled') current.ears = ears.value;
        if (tracking.status === 'rejected') throw tracking.reason;
        if (ears.status === 'rejected') throw ears.reason;

        stage.insertBefore(canvas, document.querySelector('#effects'));
        stage.classList.add('active');
        cameraButton.disabled = false;
        cameraButton.textContent = 'Apagar cámara';
        current.frame = requestAnimationFrame(time => frame(current, time));
        import('./bearry-fruit-rain.js').then(({ createFruitRain }) => createFruitRain(video)).then(fruitRain => {
            if (session !== current) {
                fruitRain.dispose();
                return;
            }
            current.fruitRain = fruitRain;
            fruitRain.mount();
        }).catch(error => console.warn('No se pudo iniciar la lluvia de frutas.', error));
    } catch (error) {
        if (session !== current) return;
        console.error(error);
        const messages = {
            NotAllowedError: 'Permite el acceso a la cámara y vuelve a intentarlo.',
            NotFoundError: 'No se encontró una cámara.',
            NotReadableError: 'La cámara está ocupada o no está disponible.',
        };
        stop(messages[error.name] ?? 'No se pudo cargar el filtro. Intenta de nuevo.');
    }
}

cameraButton.addEventListener('click', () => session ? stop() : start());
window.addEventListener('pagehide', () => stop());
cameraButton.disabled = false;
testSoundButton.disabled = false;
