/* Generador de código de barras Code 39 → SVG (vanilla, sin librerías).
   Code 39 codifica dígitos, mayúsculas y algunos símbolos. Es un código
   de barras real y escaneable. Lo usamos para el N° de control INTERNO
   del local (no tiene relación con el SRI). */
(function () {
  const C39 = {
    "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn",
    "4": "nnnwwnnnw", "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw",
    "8": "wnnwnnwnn", "9": "nnwwnnwnn", "A": "wnnnnwnnw", "B": "nnwnnwnnw",
    "C": "wnwnnwnnn", "D": "nnnnwwnnw", "E": "wnnnwwnnn", "F": "nnwnwwnnn",
    "G": "nnnnnwwnw", "H": "wnnnnwwnn", "I": "nnwnnwwnn", "J": "nnnnwwwnn",
    "K": "wnnnnnnww", "L": "nnwnnnnww", "M": "wnwnnnnwn", "N": "nnnnwnnww",
    "O": "wnnnwnnwn", "P": "nnwnwnnwn", "Q": "nnnnnnwww", "R": "wnnnnnwwn",
    "S": "nnwnnnwwn", "T": "nnnnwnwwn", "U": "wwnnnnnnw", "V": "nwwnnnnnw",
    "W": "wwwnnnnnn", "X": "nwnnwnnnw", "Y": "wwnnwnnnn", "Z": "nwwnwnnnn",
    "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn"
  };

  // Devuelve un <svg> (string) con el código de barras del texto dado.
  window.barcode39SVG = function (data, opts) {
    opts = opts || {};
    const narrow = opts.narrow || 2;
    const ratio = opts.ratio || 3;
    const height = opts.height || 55;
    const limpio = String(data).toUpperCase().replace(/[^0-9A-Z\-. ]/g, "");
    const texto = "*" + limpio + "*";

    let x = 0;
    let rects = "";
    for (let ci = 0; ci < texto.length; ci++) {
      const pat = C39[texto[ci]];
      if (!pat) continue;
      for (let i = 0; i < 9; i++) {
        const w = pat[i] === "w" ? narrow * ratio : narrow;
        if (i % 2 === 0) { // posiciones pares = barra
          rects += '<rect x="' + x + '" y="0" width="' + w + '" height="' + height + '"/>';
        }
        x += w;
      }
      x += narrow; // espacio entre caracteres
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + x + '" height="' + height +
      '" viewBox="0 0 ' + x + ' ' + height + '" fill="#000" preserveAspectRatio="none">' +
      rects + '</svg>';
  };
})();
