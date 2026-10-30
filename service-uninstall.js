const Service = require('node-windows').Service;
const path = require('path');

const svc = new Service({
  name: 'ingestIAService',
  script: path.join(__dirname, 'src', 'index.js')
});

svc.on('uninstall', function () {
  console.log('Servicio ingestIAService desinstalado completamente de Windows.');
  console.log('Existe la certeza de que el servicio ya no está registrado.');
});

svc.uninstall();
