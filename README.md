# ingestIA - Guía de Producción & Arquitectura Integral

Sistema integral de detección de cambios y sincronización en tiempo real entre **SAP Business One (HANA + Service Layer)** y la **API de Ingestión Comercia**, con configuración centralizada en **PostgreSQL**, diseñado para operar 24/7 en **Windows Server 2019** con el **Backend como Servicio de Windows (NSSM)** y el **Frontend bajo IIS**.

---

## 📐 Puertos y Rutas en Producción

| Componente | Directorio en Servidor | Puerto | Tecnología / Host | Repositorio GitHub |
| :--- | :--- | :--- | :--- | :--- |
| **BackEnd** | `C:\inetpub\ingestiaBack` | **9015** | Node.js + Express (Servicio Windows NSSM) | [ingestiaBack](https://github.com/gsilverd2239/ingestiaBack.git) |
| **FrontEnd** | `C:\inetpub\ingestiaFront` | **9025** | Next.js 16 + React 19 (IIS Web Site + Reverse Proxy) | [ingestiaFront](https://github.com/gsilverd2239/ingestiaFront.git) |

> [!NOTE]
> El FrontEnd en el puerto `9025` se comunica de forma automática con el BackEnd en el puerto `9015`. Gracias al selector dinámico de host incorporado, funciona tanto accediendo localmente desde el servidor (`http://localhost:9025`) como desde cualquier máquina de la red (`http://<IP_SERVIDOR>:9025`).

---

## 🏗️ Arquitectura de la Solución

```
C:\inetpub\
├── ingestiaBack\                    # Backend (Puerto 9015 - Servicio Windows)
│   ├── config\
│   │   └── config.json              # Configuración local de fallback
│   ├── logs\                        # Logs de Winston rotativos (ingestia.log, error.log)
│   ├── src\
│   │   ├── db\
│   │   │   ├── pg.js                # Pool de conexión PostgreSQL (172.19.0.232:5432)
│   │   │   └── configRepository.js  # Repositorio CRUD de tablas de configuración
│   │   ├── config.js                # Gestor de configuración activa en memoria
│   │   ├── engine.js                # Motor de polling continuo y orquestación
│   │   ├── hanaClient.js            # Conexión directa a SAP HANA DB (puerto 30015)
│   │   ├── serviceLayerClient.js    # Cliente HTTP autenticado contra SAP Service Layer
│   │   ├── transformer.js           # Normalización de datos (OCRD, OITM, JCANAL, etc.)
│   │   ├── ingestionClient.js       # Cliente HTTP PUT/POST con Smart Fallback y lógica ENDURO
│   │   ├── logger.js                # Winston logger con búfer en memoria para frontend
│   │   ├── server.js                # API REST con endpoints de monitoreo, simulación y CRUD
│   │   └── index.js                 # Punto de entrada principal
│   └── package.json
│
└── ingestiaFront\                   # Frontend (Puerto 9025 - IIS Site)
    ├── app\
    │   ├── layout.js                # Layout base con fuentes y estilos
    │   ├── globals.css              # Sistema visual Glassmorphism Dark Mode
    │   └── page.js                  # Dashboard interactivo, logs en vivo y CRUDs PostgreSQL
    ├── web.config                   # Configuración de IIS con Reverse Proxy (URL Rewrite + ARR)
    ├── package.json
    └── next.config.mjs
```

---

## ⚡ Comportamiento ENDURO (Sincronización Dual)

El motor detecta eventos desde `TBL_COMERCIA_EVENTS` en SAP HANA y ejecuta sincronización dual en código sin depender de plantillas en PostgreSQL para estos dos objetos clave:

### 1. ObjectType = 4 (Artículos / OITM + ITM1 Precios)
- **Service Layer**: Consulta `/b1s/v1/Items('{EntryKey}')`.
- **Cabecera `tbl_oitm`**:
  - `POST /catalogo/empresas/{empresaId}/tbl_oitm` (si `Action = 'A'`) con fallback a `PUT`.
  - `PUT /catalogo/empresas/{empresaId}/tbl_oitm/{ItemCode}` (si `Action = 'U'`) con fallback a `POST`.
  - Mapeo exacto de campos: `DfltWH`, `ItemCode`, `ItemName`, `SWeight1`, `validFor`, `TaxCodeAR`, `U_ItemQty` (entero), `U_beas_vg` (string), `frozenFor`, `ItmsGrpCod`, `QryInventario`.
- **Listas de Precios `tbl_itm1`**:
  - Recorre en paralelo las listas del array `ItemPrices`.
  - Formatea precios obligatoriamente con 6 decimales (`Price: "95000.000000"`).
  - `PUT /catalogo/empresas/{empresaId}/tbl_itm1/{ItemCode}/{PriceList}` (con fallback a `POST` si el precio > 0 y no existía en la tabla; omite precios en 0 inexistentes).

### 2. ObjectType = 2 (Socios de Negocio / OCRD + CRD1 Direcciones)
- **Service Layer**: Consulta `/b1s/v1/BusinessPartners('{EntryKey}')`.
- **Cabecera `tbl_ocrd`**:
  - `POST /socios-negocio/empresas/{empresaId}/tbl_ocrd` (si `Action = 'A'`) con fallback a `PUT`.
  - `PUT /socios-negocio/empresas/{empresaId}/tbl_ocrd/{CardCode}` (si `Action = 'U'`) con fallback a `POST`.
  - Mapeo de 26 atributos requeridos (incluyendo `QryGroup3..7` como `QryLunes..Viernes`).
- **Direcciones `tbl_crd1`**:
  - Recorre el array `BPAddresses` de Service Layer.
  - Mapea: `AddressName` ➔ `Address`, `Street` ➔ `Street`, `AddressType` (`bo_ShipTo`/`bo_BillTo`) ➔ `AdresType` (`'S'`/`'B'`).
  - Consulta direcciones existentes para el socio y ejecuta `PUT /socios-negocio/empresas/{empresaId}/tbl_crd1/{CardCode}?direccion={...}` con selector JSON completo para evitar conflictos con múltiples direcciones.
  - Inserta nuevas direcciones mediante `POST /socios-negocio/empresas/{empresaId}/tbl_crd1`.

---

## 🚀 PASO A PASO: Despliegue en Windows Server 2019

### Paso 1: Prerrequisitos en el Servidor
1. **Node.js**:
   - Descargar e instalar **Node.js v20.x LTS (x64)** desde [nodejs.org](https://nodejs.org).
   - Verificar en PowerShell: `node -v` y `npm -v`.
2. **NSSM (Non-Sucking Service Manager)**:
   - Descargar NSSM desde [nssm.cc](https://nssm.cc/download).
   - Descomprimir y copiar `nssm.exe` (versión `win64`) en `C:\Windows\System32` (o en `C:\nssm\` y agregarlo a las variables de entorno `PATH`).
   - Verificar en PowerShell: `nssm version`.
3. **IIS (Internet Information Services)**:
   - Instalar el rol **Web Server (IIS)** desde *Server Manager -> Add Roles and Features*.
   - Descargar e instalar los siguientes módulos oficiales de Microsoft:
     - [URL Rewrite Module 2.1](https://www.iis.net/downloads/microsoft/url-rewrite)
     - [Application Request Routing (ARR) 3.0](https://www.iis.net/downloads/microsoft/application-request-routing)
   - **Habilitar Proxy en ARR**:
     1. Abrir **IIS Manager** (`inetmgr`).
     2. Hacer clic en el nombre del servidor en el panel izquierdo.
     3. Doble clic en **Application Request Routing**.
     4. En el panel derecho *Actions*, hacer clic en **Server Proxy Settings**.
     5. Marcar la casilla **Enable proxy** y hacer clic en **Apply**.
4. **Reglas de Firewall**:
   Abrir PowerShell como Administrador y habilitar los puertos 9015 y 9025:
   ```powershell
   New-NetFirewallRule -DisplayName "ingestIA BackEnd (9015)" -Direction Inbound -LocalPort 9015 -Protocol TCP -Action Allow
   New-NetFirewallRule -DisplayName "ingestIA FrontEnd (9025)" -Direction Inbound -LocalPort 9025 -Protocol TCP -Action Allow
   ```

---

### Paso 2: Crear las Carpetas en `inetpub`

Abrir PowerShell como Administrador:
```powershell
New-Item -ItemType Directory -Path "C:\inetpub\ingestiaBack" -Force
New-Item -ItemType Directory -Path "C:\inetpub\ingestiaFront" -Force
```

---

### Paso 3: Despliegue del Backend (`ingestiaBack`) en Puerto 9015 con NSSM

1. **Descargar el Código en `C:\inetpub\ingestiaBack`**:
   - **Opción A (Recomendada si NO tienes Git instalado en el servidor)**:
     ```powershell
     cd C:\inetpub\ingestiaBack
     Invoke-WebRequest -Uri "https://github.com/gsilverd2239/ingestiaBack/archive/refs/heads/master.zip" -OutFile "back.zip"
     Expand-Archive -Path "back.zip" -DestinationPath "temp_back" -Force
     Copy-Item -Path "temp_back\ingestiaBack-master\*" -Destination "C:\inetpub\ingestiaBack" -Recurse -Force
     Remove-Item "back.zip", "temp_back" -Recurse -Force
     ```
   - **Opción B (Si tienes Git instalado en el servidor)**:
     ```powershell
     cd C:\inetpub\ingestiaBack
     git clone https://github.com/gsilverd2239/ingestiaBack.git .
     ```
   *(O bien copiar manualmente los archivos desde tu equipo asegurando que `src/`, `config/`, `package.json` queden en la raíz de `C:\inetpub\ingestiaBack`)*.

2. **Instalar Dependencias**:
   ```powershell
   cd C:\inetpub\ingestiaBack
   npm install --omit=dev
   npm run build
   ```

3. **Crear y Configurar el Servicio de Windows con NSSM**:
   Ejecutar en PowerShell como Administrador:
   ```powershell
   # Ruta a node.exe (habitualmente C:\Program Files\nodejs\node.exe)
   $nodePath = (Get-Command node).Source

   # 1. Instalar el servicio apuntando a index.js
   nssm install ingestiaBack "$nodePath" "C:\inetpub\ingestiaBack\src\index.js"

   # 2. Configurar directorio de trabajo
   nssm set ingestiaBack AppDirectory "C:\inetpub\ingestiaBack"

   # 3. Metadatos del servicio
   nssm set ingestiaBack DisplayName "ingestIA - Servicio de Integracion SAP B1"
   nssm set ingestiaBack Description "Motor de polling y sincronizacion continua SAP HANA/Service Layer a Ingestion Comercia"
   nssm set ingestiaBack Start SERVICE_AUTO_START

   # 4. Configurar logs de consola para auditoría
   New-Item -ItemType Directory -Path "C:\inetpub\ingestiaBack\logs" -Force
   nssm set ingestiaBack AppStdout "C:\inetpub\ingestiaBack\logs\service-stdout.log"
   nssm set ingestiaBack AppStderr "C:\inetpub\ingestiaBack\logs\service-stderr.log"

   # 5. Iniciar el servicio
   nssm start ingestiaBack
   ```

4. **Verificar que el Backend esté Corriendo**:
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:9015/api/status"
   ```
   Debe devolver JSON con `service: "ingestIA Service"`, `engine.isRunning: true` y las conexiones a HANA, PostgreSQL y SAP Service Layer activas.

---

### Paso 4: Despliegue del Frontend (`ingestiaFront`) en IIS en Puerto 9025

El Frontend es una aplicación Next.js. La arquitectura recomendada y estándar en entornos Windows Server bajo IIS es:
- **Next.js Server**: Corre internamente en el puerto `9026` mediante un servicio NSSM (`ingestiaFrontSvc`).
- **IIS Web Site**: Escucha en el puerto oficial **`9025`** y utiliza el archivo `web.config` (con URL Rewrite + ARR) para reenviar las peticiones al servidor Next.js, permitiendo administrar certificados SSL, encabezados y seguridad desde IIS.

1. **Descargar el Código en `C:\inetpub\ingestiaFront`**:
   - **Opción A (Recomendada si NO tienes Git instalado en el servidor)**:
     ```powershell
     cd C:\inetpub\ingestiaFront
     Invoke-WebRequest -Uri "https://github.com/gsilverd2239/ingestiaFront/archive/refs/heads/master.zip" -OutFile "front.zip"
     Expand-Archive -Path "front.zip" -DestinationPath "temp_front" -Force
     Copy-Item -Path "temp_front\ingestiaFront-master\*" -Destination "C:\inetpub\ingestiaFront" -Recurse -Force
     Remove-Item "front.zip", "temp_front" -Recurse -Force
     ```
   - **Opción B (Si tienes Git instalado en el servidor)**:
     ```powershell
     cd C:\inetpub\ingestiaFront
     git clone https://github.com/gsilverd2239/ingestiaFront.git .
     ```

2. **Instalar Dependencias y Compilar para Producción**:
   ```powershell
   cd C:\inetpub\ingestiaFront
   npm install
   npm run build
   ```
   *(Verificar que termine con `Compiled successfully` y cree la carpeta `.next/`)*.

3. **Crear el Servicio de Windows para el Runtime de Next.js**:
   En PowerShell como Administrador:
   ```powershell
   $nodePath = (Get-Command node).Source
   $nextBin = "C:\inetpub\ingestiaFront\node_modules\next\dist\bin\next"

   # Instalar servicio para ejecutar 'next start -p 9026'
   nssm install ingestiaFrontSvc "$nodePath" "$nextBin start -p 9026"
   nssm set ingestiaFrontSvc AppDirectory "C:\inetpub\ingestiaFront"
   nssm set ingestiaFrontSvc DisplayName "ingestIA - Frontend Next.js Runtime"
   nssm set ingestiaFrontSvc Description "Servidor Node.js interno de Next.js para ingestIA Dashboard"
   nssm set ingestiaFrontSvc Start SERVICE_AUTO_START
   nssm start ingestiaFrontSvc
   ```

4. **Crear el Sitio Web en IIS (Puerto 9025)**:
   Ejecutar en PowerShell como Administrador:
   ```powershell
   Import-Module WebAdministration

   # 1. Crear Application Pool
   New-WebAppPool -Name "ingestiaFrontPool"
   Set-ItemProperty "IIS:\AppPools\ingestiaFrontPool" -Name "managedRuntimeVersion" -Value ""

   # 2. Crear Sitio Web apuntando a C:\inetpub\ingestiaFront en el puerto 9025
   New-WebSite -Name "ingestiaFront" -Port 9025 -PhysicalPath "C:\inetpub\ingestiaFront" -ApplicationPool "ingestiaFrontPool"

   # 3. Asignar permisos de lectura a la carpeta para IIS
   icacls "C:\inetpub\ingestiaFront" /grant "IIS_IUSRS:(OI)(CI)RX" /T
   ```

5. **Verificar el archivo `web.config`**:
   Asegurarse de que en `C:\inetpub\ingestiaFront\web.config` esté presente la regla de reescritura hacia `http://127.0.0.1:9026/{R:1}`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <configuration>
     <system.webServer>
       <webSocket enabled="false" />
       <handlers>
         <clear />
       </handlers>
       <rewrite>
         <rules>
           <rule name="ReverseProxyToNextJS" stopProcessing="true">
             <match url="(.*)" />
             <action type="Rewrite" url="http://127.0.0.1:9026/{R:1}" />
           </rule>
         </rules>
       </rewrite>
       <httpErrors existingResponse="PassThrough" />
     </system.webServer>
   </configuration>
   ```

---

### Paso 5: Comprobación Final de la Instalación

1. **Abrir el navegador**:
   - En el propio servidor: **`http://localhost:9025`**
   - Desde otra PC en la misma red: **`http://<IP_DEL_SERVIDOR>:9025`**
2. **Validar el Dashboard**:
   - Indicador de estado: Debe mostrar **"MOTOR ACTIVO"**.
   - Tarjetas de Conectividad:
     - **PostgreSQL**: OK (`172.19.0.232/ingestia`).
     - **HANA**: OK (`172.19.0.88:30015`).
     - **Service Layer**: OK (`FG_PROD`).
     - **Ingestión API**: OK (`api.comercia.pro`).
3. **Pestaña "Simulador (OCRD, OITM+ITM1)"**:
   - Puedes realizar una prueba ingresando `ObjectType = 4` y `EntryKey = PV42` con acción `U` para verificar la sincronización inmediata de artículos y precios.

---

## 🛠️ Comandos de Mantenimiento

### Control de Servicios NSSM:
```cmd
:: Ver estado
nssm status ingestiaBack
nssm status ingestiaFrontSvc

:: Reiniciar servicios
nssm restart ingestiaBack
nssm restart ingestiaFrontSvc

:: Detener servicios
nssm stop ingestiaBack
nssm stop ingestiaFrontSvc

:: Ver interfaz gráfica de configuración
nssm edit ingestiaBack
```

### Ubicación de Logs para Soporte:
- **Logs del Backend ingestIA**: `C:\inetpub\ingestiaBack\logs\ingestia.log`
- **Logs de Errores del Backend**: `C:\inetpub\ingestiaBack\logs\error.log`
- **Salida de Consola NSSM BackEnd**: `C:\inetpub\ingestiaBack\logs\service-stdout.log`
- **Salida de Consola NSSM FrontEnd**: `C:\inetpub\ingestiaFront\logs\` (si se configuró)

---

## 🔄 Procedimiento para Actualizar Versiones Futuras

Cuando haya nuevas actualizaciones en GitHub:

```powershell
# 1. Actualizar BackEnd
cd C:\inetpub\ingestiaBack
git pull origin master
npm install --omit=dev
nssm restart ingestiaBack

# 2. Actualizar FrontEnd
cd C:\inetpub\ingestiaFront
git pull origin master
npm install
npm run build
nssm restart ingestiaFrontSvc
```
