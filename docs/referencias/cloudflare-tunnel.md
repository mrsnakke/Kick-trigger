
# Guía Completa de Cloudflare Tunnel en Zero Trust

## 1. Introducción y Arquitectura

Cloudflare Tunnel proporciona una forma segura de conectar sus recursos a Cloudflare sin una dirección IP públicamente direccionable. Con Tunnel, no se envía tráfico directo a una IP externa; en su lugar, un daemon ligero en su infraestructura (`cloudflared`) crea conexiones únicamente de salida (outbound-only) a la red global de Cloudflare. 

```
                                 Outbound-only (Puerto 7844 TCP/UDP)
+-------------------------+                                           +--------------------------+
|  Servidor de Origen     | ========================================> | Red Global de Cloudflare |
|  (Ejecuta cloudflared)  | <======================================== |                          |
+-------------------------+          Tráfico bidireccional            +--------------------------+
```

### Conexiones de salida únicamente
`cloudflared` inicia la conexión a través de su firewall desde el origen hacia la red de Cloudflare. Una vez establecido el túnel, el tráfico fluye en ambas direcciones. Esto le permite configurar su firewall para bloquear por completo el tráfico de entrada directo a su servidor, eliminando vectores de ataque externos.

---

## 2. Creación de un Túnel (Dashboard)

### Paso 1: Crear el Túnel e Instalar el Conector
1. Inicie sesión en el dashboard de Cloudflare y vaya a **Networking** > **Tunnels**.
2. Seleccione **Create a tunnel**.
3. Introduzca un nombre para su túnel (por ejemplo, `enterprise-VPC-01`).
4. Seleccione su sistema operativo y arquitectura, copie el comando de instalación proporcionado y ejecútelo en una terminal en su servidor de origen.
5. Espere a que el conector aparezca con el estado **Healthy**. Seleccione **Continue**.

### Paso 2a: Publicar una Aplicación en Internet
1. Vaya a **Networking** > **Tunnels** y seleccione su túnel.
2. En la pestaña **Routes**, seleccione **Add route** > **Published application**.
3. Introduzca un subdominio y elija un dominio de la lista desplegable.
4. En **Service URL**, introduzca el protocolo y la dirección local del servicio de destino (por ejemplo, `http://localhost:8000`).
5. Seleccione **Save**.

### Paso 2b: Conectar una Red Privada (Ruta CIDR)
1. Vaya a **Networking** > **Routes**.
2. Seleccione **Create route** > **Tunnel CIDR**.
3. Seleccione el túnel que acaba de crear.
4. En **Network**, introduzca el rango de direcciones IP privadas de su red (por ejemplo, `10.0.0.0/24` o una IP individual como `10.0.0.1`).
5. Seleccione **Create route**.

---

## 3. Creación de un Túnel (API de Cloudflare)

### Paso 1: API Token y Permisos
Cree un token de API de Cloudflare con los siguientes permisos mínimos:
* **Account**: `Cloudflare Tunnel` o `Cloudflare One Connectors` -> **Edit**
* **Zone**: `DNS` -> **Edit**

### Paso 2: Crear el Túnel por API
Realice una petición `POST` reemplazando `$ACCOUNT_ID` y `$CLOUDFLARE_API_TOKEN` por sus credenciales:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "name": "api-tunnel",
    "config_src": "cloudflare"
  }'
```

#### Respuesta de ejemplo:
```json
{
  "success": true,
  "errors": [],
  "messages": [],
  "result": {
    "id": "c1744f8b-faa1-48a4-9e5c-02ac921467fa",
    "account_tag": "699d98642c564d2e855e9661899b7252",
    "created_at": "2025-02-18T22:41:43.534395Z",
    "deleted_at": null,
    "name": "api-tunnel",
    "connections": [],
    "conns_active_at": null,
    "conns_inactive_at": "2025-02-18T22:41:43.534395Z",
    "tun_type": "cfd_tunnel",
    "metadata": {},
    "status": "inactive",
    "remote_config": true,
    "credentials_file": {
      "AccountTag": "699d98642c564d2e855e9661899b7252",
      "TunnelID": "c1744f8b-faa1-48a4-9e5c-02ac921467fa",
      "TunnelName": "api-tunnel",
      "TunnelSecret": "bTSquyUGwLQjYJn8cI8S1h6M6wUc2ajIeT7JotlxI7TqNqdKFhuQwX3O8irSnb=="
    },
    "token": "eyJhIjoiNWFiNGU5Z..."
  }
}
```

### Paso 3a: Configurar las Reglas de Ingress
Actualice la configuración del túnel para mapear un host de entrada a un servicio local mediante una petición `PUT`:

```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/$TUNNEL_ID/configurations" \
  --request PUT \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "config": {
        "ingress": [
            {
                "hostname": "app.example.com",
                "service": "http://localhost:8001",
                "originRequest": {}
            },
            {
                "service": "http_status:404"
            }
        ]
    }
  }'
```

### Paso 3b: Crear el Registro DNS
Cree un registro DNS de tipo `CNAME` apuntando a `<TUNNEL_ID>.cfargotunnel.com` mediante una petición `POST`:

```bash
curl "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "type": "CNAME",
    "proxied": true,
    "name": "app.example.com",
    "content": "c1744f8b-faa1-48a4-9e5c-02ac921467fa.cfargotunnel.com"
  }'
```

### Paso 3c: Crear Ruta de Red Privada por API
```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/teamnet/routes" \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  --json '{
    "network": "172.16.0.0/16",
    "tunnel_id": "c1744f8b-faa1-48a4-9e5c-02ac921467fa",
    "comment": "Example private network route"
  }'
```

### Paso 4: Consultar el Estado del Túnel por API
```bash
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/cfd_tunnel/c1744f8b-faa1-48a4-9e5c-02ac921467fa" \
  --request GET \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

---

## 4. Archivos de Configuración e Ingress Rules (Túneles Locales)

Los túneles locales dependen de un archivo de configuración en formato YAML. Por defecto, se busca en:
* **Windows**: `%USERPROFILE%\.cloudflared\config.yml`
* **macOS/Linux**: `~/.cloudflared/config.yml` o `/etc/cloudflared/config.yml`

### Ejemplo de Configuración para Redes Privadas (`config.yml`)
```yaml
tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef
credentials-file: /root/.cloudflared/6ff42ae2-765d-4adf-8112-31c55c1551ef.json
warp-routing:
  enabled: true
```

### Ejemplo de Configuración para Aplicaciones Publicadas con Parámetros Avanzados
```yaml
tunnel: 6ff42ae2-765d-4adf-8112-31c55c1551ef
credentials-file: /root/.cloudflared/6ff42ae2-765d-4adf-8112-31c55c1551ef.json

originRequest:
  connectTimeout: 30s
  keepAliveConnections: 100
  noTLSVerify: false

ingress:
  - hostname: gitlab.widgetcorp.tech
    service: http://localhost:80
  - hostname: gitlab-ssh.widgetcorp.tech
    service: ssh://localhost:22
  - hostname: static.widgetcorp.tech
    path: \.(jpg|png|css|js)$
    service: http://localhost:8081
  - hostname: "*.widgetcorp.tech"
    service: https://localhost:8443
    originRequest:
      connectTimeout: 10s
      noTLSVerify: true
      originServerName: widgetcorp.tech
  - service: http_status:404
```

---

## 5. Parámetros de Ejecución (Run Parameters)

Al iniciar el daemon con `cloudflared tunnel run` o mediante la configuración de un servicio del sistema, puede utilizar los siguientes modificadores:

| Parámetro | Variable de Entorno | Por defecto | Descripción |
| :--- | :--- | :--- | :--- |
| `--autoupdate-freq` | - | `24h` | Frecuencia de comprobación de actualizaciones de `cloudflared`. |
| `--no-autoupdate` | `NO_AUTOUPDATE` | - | Desactiva las actualizaciones automáticas del daemon. |
| `--dns-resolver-addrs`| `TUNNEL_DNS_RESOLVER_ADDRS`| - | Especifica servidores DNS personalizados en formato `IP:PORT`. |
| `--edge-bind-address` | `TUNNEL_EDGE_BIND_ADDRESS`| - | Vincula el tráfico saliente a una IP local de interfaz específica. |
| `--edge-ip-version`   | `TUNNEL_EDGE_IP_VERSION`  | `4` | Fuerza la versión de IP para conectar a Cloudflare (`4`, `6` o `auto`). |
| `--grace-period`      | `TUNNEL_GRACE_PERIOD`     | `30s` | Lapso para drenar peticiones activas antes de apagar el daemon. |
| `--logfile`           | `TUNNEL_LOGFILE`          | - | Ruta del archivo de guardado físico para los registros de depuración. |
| `--loglevel`          | `TUNNEL_LOGLEVEL`         | `info` | Nivel de logs: `debug`, `info`, `warn`, `error`, `fatal`. |
| `--metrics`           | `TUNNEL_METRICS`          | - | Expone un servidor HTTP Prometheus (ej. `127.0.0.1:20241/metrics`). |
| `--protocol`          | `TUNNEL_TRANSPORT_PROTOCOL`| `auto` | Protocolo de red: `auto`, `http2` (TCP), `quic` (UDP). |
| `--region`            | `TUNNEL_REGION`           | - | Configura la conexión a una región específica (por ejemplo, `us`). |
| `--retries`           | `TUNNEL_RETRIES`          | `5` | Reintentos de reconexión inicial utilizando exponential backoff. |

---

## 6. Configuración del Firewall (Egress Rules)

Para garantizar un modelo de seguridad restrictivo, configure el firewall perimetral o del servidor local para permitir únicamente el tráfico saliente (Egress) en el **puerto 7844 (TCP/UDP)** hacia los siguientes rangos de red:

### Endpoints de Conexión de Cloudflare

#### Región Global (Predeterminada)
* **`region1.v2.argotunnel.com`**
  * **IPv4**: `198.41.192.167`, `198.41.192.67`, `198.41.192.57`, `198.41.192.107`, `198.41.192.27`, `198.41.192.7`, `198.41.192.227`, `198.41.192.47`, `198.41.192.37`, `198.41.192.77`
  * **IPv6**: `2606:4700:a0::1` a `2606:4700:a0::10`
* **`region2.v2.argotunnel.com`**
  * **IPv4**: `198.41.200.13`, `198.41.200.193`, `198.41.200.33`, `198.41.200.233`, `198.41.200.53`, `198.41.200.63`, `198.41.200.113`, `198.41.200.73`, `198.41.200.43`, `198.41.200.23`
  * **IPv6**: `2606:4700:a8::1` a `2606:4700:a8::10`

#### Región US (Con flag `--region us`)
* **`us-region1.v2.argotunnel.com`**
  * **IPv4**: `198.41.218.1` a `198.41.218.10`
  * **IPv6**: `2606:4700:a1::1` a `2606:4700:a1::10`
* **`us-region2.v2.argotunnel.com`**
  * **IPv4**: `198.41.219.1` a `198.41.219.10`
  * **IPv6**: `2606:4700:a9::1` a `2606:4700:a9::10`

#### Región FedRAMP High
* **`fed-region1.v2.argotunnel.com`**
  * **IPv4**: `162.159.234.1` a `162.159.234.10`
  * **IPv6**: `2a06:98c1:4d::1` a `2a06:98c1:4d::10`
* **`fed-region2.v2.argotunnel.com`**
  * **IPv4**: `172.64.234.1` a `172.64.234.10`
  * **IPv6**: `2606:4700:f6::1` a `2606:4700:f6::10`

---

## 7. Despliegue en Entornos Reales (GCP, AWS, Azure, Kubernetes, Ansible, Terraform)

### 7.1. Ansible y Terraform (GCP)
El siguiente flujo utiliza Terraform para aprovisionar una máquina virtual en Google Cloud Engine (GCE), crear un túnel administrado por Cloudflare, y ejecutar un playbook de Ansible para instalar, configurar y levantar el daemon automáticamente.

#### Archivo `variables.tf`
```hcl
variable "gcp_project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "zone" {
  description = "GCP VM Zone"
  type        = string
}

variable "machine_type" {
  description = "GCP VM Machine Type"
  type        = string
}

variable "cloudflare_zone" {
  description = "Domain Zone"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID"
  type        = string
}

variable "cloudflare_account_id" {
  description = "Cloudflare Account ID"
  type        = string
  sensitive   = true
}

variable "cloudflare_email" {
  description = "Cloudflare Account Email"
  type        = string
  sensitive   = true
}

variable "cloudflare_token" {
  description = "Cloudflare API Token"
  type        = string
  sensitive   = true
}
```

#### Archivo `terraform.tfvars`
```hcl
cloudflare_zone           = "example.com"
cloudflare_zone_id        = "023e105f4ecef8ad9ca31a8372d0c353"
cloudflare_account_id     = "372e67954025e0ba6aaa6d586b9e0b59"
cloudflare_email          = "user@example.com"
cloudflare_token          = "y3AalHS_E7Vabk3c3lX950F90_Xl7YtjSlzyFn_X"
gcp_project_id            = "testvm-123"
zone                      = "us-central1-a"
machine_type              = "e2-medium"
```

#### Archivo `providers.tf`
```hcl
terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = ">= 5.8.2"
    }
    google = {
      source = "hashicorp/google"
    }
  }
  required_version = ">= 1.2"
}

provider "cloudflare" {
  api_token = var.cloudflare_token
}

provider "google" {
  project = var.gcp_project_id
}

provider "random" {}
```

#### Archivo `Cloudflare-config.tf`
```hcl
resource "cloudflare_zero_trust_tunnel_cloudflared" "gcp_tunnel" {
  account_id = var.cloudflare_account_id
  name       = "Ansible GCP tunnel"
  config_src = "cloudflare"
}

data "cloudflare_zero_trust_tunnel_cloudflared_token" "gcp_tunnel_token" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.id
}

resource "cloudflare_dns_record" "http_app" {
  zone_id = var.cloudflare_zone_id
  name    = "http_app"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "gcp_tunnel_config" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.id
  account_id = var.cloudflare_account_id
  config = {
    ingress = [
      {
        hostname = "http_app.${var.cloudflare_zone}"
        service  = "http://localhost:80"
      },
      {
        service  = "http_status:404"
      }
    ]
  }
}
```

#### Archivo `GCP-config.tf`
```hcl
data "google_compute_image" "image" {
  family  = "ubuntu-2204-lts"
  project = "ubuntu-os-cloud"
}

resource "google_compute_instance" "http_server" {
  name         = "ansible-inst"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = []

  boot_disk {
    initialize_params {
      image = data.google_compute_image.image.self_link
    }
  }

  network_interface {
    network = "default"
    access_config {
      // Ephemeral IP
    }
  }

  scheduling {
    preemptible       = true
    automatic_restart = false
  }

  provisioner "remote-exec" {
    inline = [
      "sudo apt update",
      "sudo apt install python3 -y",
      "echo Done!"
    ]
    connection {
      host        = self.network_interface.0.access_config.0.nat_ip
      user        = "gcp_user"
      type        = "ssh"
      private_key = file("~/.ssh/gcp_ssh")
    }
  }

  provisioner "local-exec" {
    command = "ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -u gcp_user --private-key ~/.ssh/gcp_ssh -i ${self.network_interface.0.access_config.0.nat_ip}, playbook.yml"
  }

  metadata = {
    cf-email = var.cloudflare_email
    cf-zone  = var.cloudflare_zone
    ssh-keys = "gcp_user:${file("~/.ssh/gcp_ssh.pub")}"
  }

  depends_on = [local_file.tf_ansible_vars_file]
}
```

#### Archivo `export.tf`
```hcl
resource "local_file" "tf_ansible_vars_file" {
  content = <<-DOC
    # Ansible vars_file containing variable values from Terraform.
    tunnel_id: ${cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.id}
    tunnel_name: ${cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.name}
    tunnel_token: ${data.cloudflare_zero_trust_tunnel_cloudflared_token.gcp_tunnel_token.token}
    DOC

  filename = "./tf_ansible_vars_file.yml"
}
```

#### Archivo de Playbook de Ansible (`playbook.yml`)
```yaml
---
- hosts: all
  become: yes
  vars_files:
    - ./tf_ansible_vars_file.yml
  tasks:
    - name: Download the cloudflared Linux package
      shell: wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
    - name: Depackage cloudflared
      shell: sudo dpkg -i cloudflared-linux-amd64.deb
    - name: Install the tunnel as a systemd service
      shell: "cloudflared service install {{ tunnel_token }}"
    - name: Start the tunnel
      systemd:
        name: cloudflared
        state: started
        enabled: true
    - name: Deploy an example Apache web server on port 80
      shell: apt update && apt -y install apache2
    - name: Edit the default Apache index file
      copy:
        dest: /var/www/html/index.html
        content: |
          <!DOCTYPE html>
          <html>
          <body>
            <h1>Hello Cloudflare!</h1>
            <p>This page was created for a Cloudflare demo via Ansible and Terraform.</p>
          </body>
          </html>
```

---

### 7.2. Despliegue Completo en Kubernetes
Este manifiesto despliega de forma nativa la aplicación `httpbin` de ejemplo y el daemon de `cloudflared` configurado para correr como contenedor en alta disponibilidad.

#### Archivo `httpbin.yaml`
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin-deployment
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      app: httpbin
  template:
    metadata:
      labels:
        app: httpbin
    spec:
      containers:
        - name: httpbin
          image: kennethreitz/httpbin:latest
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 80
```

#### Archivo `httpbinsvc.yaml`
```yaml
apiVersion: v1
kind: Service
metadata:
  name: httpbin-service
  namespace: default
spec:
  type: LoadBalancer
  selector:
    app: httpbin
  ports:
    - port: 80
      targetPort: 80
```

#### Secreto para el Token del Túnel (`tunnel-token.yaml`)
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: tunnel-token
stringData:
  token: eyJhIjoiNWFiNGU5Z...
```

#### Archivo `tunnel.yaml` (Despliegue de cloudflared)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared-deployment
  namespace: default
spec:
  replicas: 2
  selector:
    matchLabels:
      pod: cloudflared
  template:
    metadata:
      labels:
        pod: cloudflared
    spec:
      securityContext:
        sysctls:
          - name: net.ipv4.ping_group_range
            value: "65532 65532"
      containers:
        - image: cloudflare/cloudflared:latest
          name: cloudflared
          env:
            - name: TUNNEL_TOKEN
              valueFrom:
                secretKeyRef:
                  name: tunnel-token
                  key: token
          command:
            - cloudflared
            - tunnel
            - --no-autoupdate
            - --loglevel
            - info
            - --metrics
            - 0.0.0.0:2000
            - run
          livenessProbe:
            httpGet:
              path: /ready
              port: 2000
            failureThreshold: 1
            initialDelaySeconds: 10
            periodSeconds: 10
```

---

### 7.3. Terraform Avanzado para Proveedor Versión 5 e Infraestructura como Código (AWS/GCP/Azure)
Despliegue de recursos de Cloudflare Tunnel y políticas de Access mediante el proveedor de Terraform `cloudflare/cloudflare` versión `v5.x`.

#### Archivo `Cloudflare-v5-config.tf`
```hcl
# Crear el Túnel remoto
resource "cloudflare_zero_trust_tunnel_cloudflared" "gcp_tunnel" {
  account_id    = var.cloudflare_account_id
  name          = "Terraform GCP tunnel"
  config_src    = "cloudflare"
}

# Obtener Token del túnel
data "cloudflare_zero_trust_tunnel_cloudflared_token" "gcp_tunnel_token" {
  account_id   = var.cloudflare_account_id
  tunnel_id    = cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.id
}

# Crear CNAME
resource "cloudflare_dns_record" "http_app" {
  zone_id = var.cloudflare_zone_id
  name    = "http_app"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.id}.cfargotunnel.com"
  type    = "CNAME"
  ttl     = 1
  proxied = true
}

# Configuración de Ingreso del túnel
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "gcp_tunnel_config" {
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.id
  account_id = var.cloudflare_account_id
  config     = {
    ingress   = [
      {
        hostname = "http_app.${var.cloudflare_zone}"
        service  = "http://localhost:8080"
      },
      {
        service  = "http_status:404"
      }
    ]
  }
}

# Configurar enrutamiento de Red Privada CIDR
resource "cloudflare_zero_trust_tunnel_cloudflared_route" "example_tunnel_route" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.gcp_tunnel.id
  network    = "10.128.0.0/24"
  comment    = "Example VPC route"
}

# Crear política de Access reutilizable
resource "cloudflare_zero_trust_access_policy" "allow_emails" {
  account_id   = var.cloudflare_account_id
  name         = "Allow email addresses"
  decision     = "allow"
  include      = [
    {
      email = {
        email = var.cloudflare_email
      }
    },
    {
      email_domain = {
        domain = "example.com"
      }
    }
  ]
}

# Crear la aplicación auto-hospedada (Self-hosted)
resource "cloudflare_zero_trust_access_application" "http_app" {
  account_id       = var.cloudflare_account_id
  type             = "self_hosted"
  name             = "Access application for http_app.${var.cloudflare_zone}"
  domain           = "http_app.${var.cloudflare_zone}"
  policies = [
    {
      id         = cloudflare_zero_trust_access_policy.allow_emails.id
      precedence = 1
    }
  ]
}
```

---

## 8. Casos de Uso Avanzados

### 8.1. SSH con Acceso Basado en Certificados y Auditoría de Comandos (Access for Infrastructure)
Este método sustituye las claves SSH tradicionales de larga duración por certificados efímeros de corta duración firmados por la CA de Cloudflare Gateway.

#### Paso 1: Configurar el Servidor en su `sshd_config`
1. Vaya a su panel de Zero Trust y cree un certificado SSH de CA en la sección **Access controls** > **Service credentials** > **SSH**.
2. Copie la clave pública de la CA generada por Cloudflare.
3. En su servidor, cree el archivo de confianza de CA:
   ```bash
   sudo nano /etc/ssh/ca.pub
   ```
   Pegue la clave pública (debe quedar en una sola línea):
   ```text
   ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTY... open-ssh-ca@cloudflareaccess.org
   ```
4. Configure los permisos del archivo:
   ```bash
   sudo chmod 600 /etc/ssh/ca.pub
   ```
5. Abra el archivo de configuración del daemon SSH:
   ```bash
   sudo nano /etc/ssh/sshd_config
   ```
   Agregue las siguientes directivas al final o al inicio del archivo:
   ```text
   PubkeyAuthentication yes
   TrustedUserCAKeys /etc/ssh/ca.pub
   ```
6. Guarde y aplique los cambios reiniciando o recargando el daemon SSH:
   * **Debian/Ubuntu**: `sudo systemctl reload ssh`
   * **RHEL/CentOS**: `sudo systemctl reload sshd`

#### Paso 2: Generar Claves para Cifrado de Auditoría de Comandos SSH
Para registrar de forma encriptada todos los comandos ejecutados por los usuarios sobre la consola remota, genere un par de claves HPKE usando la herramienta oficial `ssh-log-cli`:

1. Genere el par de claves localmente:
   ```bash
   ./ssh-log-cli generate-key-pair -o sshkey
   ```
   Esto creará los archivos `sshkey` (clave privada) y `sshkey.pub` (clave pública).
2. Copie el contenido de su clave pública `sshkey.pub`.
3. En el dashboard de Zero Trust, vaya a **Traffic policies** > **Traffic settings** e inserte la clave en el campo **SSH log encryption public key**.
4. Descargue y desencripte los logs de auditoría recolectados con la clave privada:
   ```bash
   ./ssh-log-cli decrypt -i sshlog -k sshkey
   ```

---

### 8.2. Enrutamiento por Nombres de Host Privados (Private Hostname Routing)
En lugar de enrutar por direcciones IP estáticas locales, este método utiliza hostnames internos mediante el daemon `cloudflared` (por ejemplo, `wiki.internal.local`).

#### Flujo de Enrutamiento de Hostname Privado
```
1. Usuario (WARP conectado) consulta: wiki.internal.local
2. Cloudflare Gateway devuelve IP virtual CGNAT (ej: 100.80.0.48)
3. WARP intercepta la IP virtual y la envía a través de Cloudflare Gateway
4. Gateway resuelve la IP real usando el resolvedor del servidor del túnel
5. cloudflared proxy la petición a la IP privada interna (ej: 10.2.0.3)
```

#### Paso 1: Agregar el Hostname Privado al Túnel
1. Vaya a **Networking** > **Tunnels** y edite su túnel.
2. En la pestaña **Routes**, seleccione **Add route** > **Private hostname**.
3. Defina el FQDN interno (por ejemplo, `wiki.internal.local`).

#### Paso 2: Resolver DNS Privado con Resolver Policies (Opcional)
Si requiere que el túnel redirija las peticiones de DNS interno hacia un servidor DNS corporativo privado:
1. Asegúrese de que el servidor DNS local (por ejemplo, `10.0.0.25`) está enrutado como CIDR en su túnel.
2. Cree una política de resolución en **Traffic policies** > **Resolver policies** > **Create a policy**:
   * **Expression**: `Host in wiki.internal.local`
   * **Configure custom DNS resolvers**: `10.0.0.25` mapeado en su red virtual asignada.

---

### 8.3. Redes Virtuales (Virtual Networks) para Direccionamiento IP Duplicado
Si cuenta con entornos paralelos (por ejemplo, Staging y Producción) que reutilizan el mismo rango de IPs privadas (`10.128.0.1/32`), puede segmentarlos de manera lógica utilizando Virtual Networks en Cloudflare.

#### Paso 1: Configurar las Redes Virtuales mediante Terraform (v5)
```hcl
# Crear las Redes Virtuales
resource "cloudflare_zero_trust_tunnel_cloudflared_virtual_network" "staging_vnet" {
  account_id = var.cloudflare_account_id
  name       = "staging-vnet"
  comment    = "Staging virtual network"
  is_default = false
}

resource "cloudflare_zero_trust_tunnel_cloudflared_virtual_network" "production_vnet" {
  account_id = var.cloudflare_account_id
  name       = "production-vnet"
  comment    = "Production virtual network"
  is_default = false
}

# Crear Túnel de Staging
resource "cloudflare_zero_trust_tunnel_cloudflared" "staging_tunnel" {
  account_id = var.cloudflare_account_id
  name       = "Staging tunnel"
  config_src = "cloudflare"
}

# Crear Túnel de Producción
resource "cloudflare_zero_trust_tunnel_cloudflared" "production_tunnel" {
  account_id = var.cloudflare_account_id
  name       = "Production tunnel"
  config_src = "cloudflare"
}

# Asociar IPs duplicadas a sus respectivas redes virtuales
resource "cloudflare_zero_trust_tunnel_cloudflared_route" "staging_tunnel_route" {
  account_id         = var.cloudflare_account_id
  tunnel_id          = cloudflare_zero_trust_tunnel_cloudflared.staging_tunnel.id
  network            = "10.128.0.1/32"
  comment            = "Staging tunnel route"
  virtual_network_id = cloudflare_zero_trust_tunnel_cloudflared_virtual_network.staging_vnet.id
}

resource "cloudflare_zero_trust_tunnel_cloudflared_route" "production_tunnel_route" {
  account_id         = var.cloudflare_account_id
  tunnel_id          = cloudflare_zero_trust_tunnel_cloudflared.production_tunnel.id
  network            = "10.128.0.1/32"
  comment            = "Production tunnel route"
  virtual_network_id = cloudflare_zero_trust_tunnel_cloudflared_virtual_network.production_vnet.id
}
```

---

## 9. Monitoreo, Pruebas y Diagnóstico de Conectividad

### 9.1. Pruebas de Diagnóstico del Host
Antes de desplegar el daemon, verifique que la resolución DNS y los puertos locales funcionan correctamente desde el servidor de origen utilizando estas pruebas:

#### Comprobar Resolución DNS Externa
```bash
dig A region1.v2.argotunnel.com
dig AAAA region1.v2.argotunnel.com
```

#### Comprobar DNS contra Servidor DNS de Cloudflare
```bash
dig A region1.v2.argotunnel.com @1.1.1.1
```

#### Comprobar Conectividad sobre UDP (QUIC)
```bash
nc -uvz -w 3 198.41.192.167 7844
```

#### Comprobar Conectividad sobre TCP (HTTP2)
```bash
nc -vz -w 3 198.41.192.167 7844
```

### 9.2. Recolectar Archivos de Diagnóstico de Túnel (`diag-logs`)
`cloudflared` incluye herramientas para generar informes completos sobre el estado del sistema, trazas de red y latencia.

#### En el Host
```bash
sudo setcap cap_net_raw+ep /usr/bin/traceroute
cloudflared tunnel diag
```
Esto creará un archivo ZIP comprimido: `cloudflared-diag-YYYY-MM-DDThh-mm-ss.zip`.

#### En Docker
Asegúrese de exponer el puerto de métricas del conector (por ejemplo, el puerto `20241`) al host y ejecute:
```bash
cloudflared tunnel diag --diag-container-id=<CONTAINER_ID>
```

#### En Kubernetes (Port-Forwarding)
Redirija el puerto local de diagnóstico `20244` al puerto interno del contenedor de `cloudflared` (por ejemplo, `12345`) en el Pod:
```bash
kubectl port-forward cloudflared-6d4897585b-r8kfz 20244:12345
cloudflared tunnel diag --diag-pod-id=<POD_ID>
```