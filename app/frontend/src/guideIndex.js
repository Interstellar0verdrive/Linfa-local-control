// Indice della "Libreria guide": elenco ordinato e raggruppato di tutte le
// guide (file .md in www/guide/). È l'unica lista curata dei titoli — quando si
// aggiunge una guida, va aggiunta qui per comparire nell'indice. L'apertura
// resta per topic (= nome file senza .md), coerente con milestone ed eventi.
export const GUIDE_INDEX = [
  {
    group: 'Fasi e decisioni',
    items: [
      { topic: 'disposizione-panetti', titolo: 'Disposizione dei panetti' },
      { topic: 'germinazione', titolo: 'Germinazione e trapianto' },
      { topic: 'topping-lst', titolo: 'Topping e LST' },
      { topic: 'flip-fioritura', titolo: 'Quando passare a fioritura' },
      { topic: 'fioritura', titolo: 'Fioritura: stretch e sostegno' },
      { topic: 'flush', titolo: 'Il flush finale' },
      { topic: 'raccolto', titolo: 'Quando raccogliere' },
      { topic: 'essiccazione', titolo: 'Essiccazione' },
      { topic: 'concia', titolo: 'La concia (curing)' },
    ],
  },
  {
    group: 'Acqua e nutrienti',
    items: [
      { topic: 'acqua-ricircoli', titolo: 'Acqua e ricircoli' },
      { topic: 'cambio-acqua', titolo: 'Cambio acqua e nutrienti' },
      { topic: 'rabbocchi', titolo: 'Rabbocchi' },
      { topic: 'ph-ec', titolo: 'pH ed EC' },
    ],
  },
  {
    group: 'Ambiente e salute',
    items: [
      { topic: 'clima-vpd', titolo: 'Clima e VPD' },
      { topic: 'carenze', titolo: 'Carenze e problemi' },
    ],
  },
]
