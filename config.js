// Nastavenie prehľadu darčekov.
// apiUrl '/api/data' = prehľad za tímovým prihlásením na Verceli. Adresu Apps Scriptu a kľúč
// nastavíš vo Verceli (premenné GAS_URL a GAS_KEY), sem nepatria.
// Bez servera (prázdne apiUrl) prehľad ukladá zmeny len v tvojom prehliadači a klientov berie z localClients.
window.DARCEKY_CONFIG = {
  apiUrl: '/api/data',
  teamName: 'Sales tím',
  pollSeconds: 60
};
