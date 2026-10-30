const Service = require('node-windows').Service;
const path = require('path');

// Create a new service object
const svc = new Service({
  name: 'ingestIAService',
  description: 'Servicio de integración SAP B1 Service Layer a Ingestión Comercia (ingestIA)',
  script: path.join(__dirname, 'src', 'index.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ],
  wait: 2,
  grow: 0.5,
  maxRetries: 5
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function () {
  console.log('Servicio ingestIAService instalado con éxito como Servicio de Windows.');
  console.log('Iniciando servicio...');
  svc.start();
});

svc.on('alreadyinstalled', function () {
  console.log('El servicio ingestIAService ya se encuentra instalado.');
});

svc.on('invalidinstallation', function () {
  console.log('Instalación inválida.');
});

svc.on('start', function () {
  console.log('Servicio ingestIAService iniciado correctamente en Windows.');
});

svc.install();
