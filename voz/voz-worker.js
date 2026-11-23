// Worker de voz: convierte texto en audio con Piper (fonemas con espeak-ng + modelo VITS en onnxruntime).
// Va en un worker para que el juego no se congele mientras se genera la voz.
importScripts('ort.wasm.min.js', 'piper_phonemize.js');
ort.env.wasm.wasmPaths = './';
ort.env.wasm.numThreads = 1; // GitHub Pages no permite hilos (falta aislamiento entre orígenes)

const modelos = {};
let datos = null, binario = null;

// Texto -> identificadores de fonemas. El módulo de espeak se crea por frase porque su main() solo puede ejecutarse una vez.
async function fonemas(texto, idioma) {
  datos ??= await (await fetch('piper_phonemize.data')).arrayBuffer();
  binario ??= await (await fetch('piper_phonemize.wasm')).arrayBuffer();
  return new Promise((ok, mal) => {
    createPiperPhonemize({
      wasmBinary: binario, getPreloadedPackage: () => datos,
      print: l => { try { ok(JSON.parse(l).phoneme_ids); } catch { /* otra salida */ } }, printErr: () => {},
      locateFile: f => f,
    }).then(m => m.callMain(['-l', idioma, '--input', JSON.stringify([{ text: texto }]), '--espeak_data', '/espeak-ng-data'])).catch(mal);
  });
}

const i64 = a => BigInt64Array.from(a, BigInt);

onmessage = async ({ data: d }) => {
  try {
    if (d.tipo === 'cargar') {
      modelos[d.lang] = { sesion: await ort.InferenceSession.create(new Uint8Array(d.onnx)), cfg: d.cfg };
      return postMessage({ id: d.id, ok: true });
    }
    const { sesion, cfg } = modelos[d.lang];
    const ids = await fonemas(d.texto, cfg.espeak.voice);
    const entrada = {
      input: new ort.Tensor('int64', i64(ids), [1, ids.length]),
      input_lengths: new ort.Tensor('int64', i64([ids.length]), [1]),
      scales: new ort.Tensor('float32', Float32Array.from([cfg.inference.noise_scale, cfg.inference.length_scale * (d.lento || 1), cfg.inference.noise_w]), [3]),
    };
    if (cfg.num_speakers > 1) entrada.sid = new ort.Tensor('int64', i64([d.sid % cfg.num_speakers]), [1]);
    const pcm = (await sesion.run(entrada)).output.data;
    postMessage({ id: d.id, pcm, sr: cfg.audio.sample_rate }, [pcm.buffer]);
  } catch (e) { postMessage({ id: d.id, error: String(e?.message || e) }); }
};
