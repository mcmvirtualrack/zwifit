#!/usr/bin/env bash
# HTTPS certificate for Zwifit from its own small certificate authority (CA).
#
# The CA is made once (tls/ca.pem + ca-key.pem) and is what other devices trust: install
# tls/zwifit-ca.cer as a trusted root on them (e.g. a managed Edge on a Surface Hub, via Intune).
# Then browsers treat https://<this PC>:<port> as secure, so "Install app" is offered and there
# is no warning. Re-run this script whenever the PC's IP address changes: it issues a new server
# certificate from the same CA, so devices need nothing new.
#
# Usage: bash scripts/wsl/make-cert.sh   (then restart Zwifit)
set -euo pipefail

dir="${ZWIFIT_DATA_DIR:-$HOME/.local/share/zwifit}/tls"
mkdir -p "$dir"
chmod 700 "$dir"
cd "$dir"

if [ ! -f ca.pem ]; then
	openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
		-subj "/CN=Zwifit local CA ($(hostname))" \
		-addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
		-addext "keyUsage=critical,keyCertSign,cRLSign" \
		-keyout ca-key.pem -out ca.pem 2>/dev/null
	chmod 600 ca-key.pem
	echo "Made a new Zwifit CA."
fi
# The file to install on other devices as a trusted root (DER, as Windows / Intune expect).
openssl x509 -in ca.pem -outform der -out zwifit-ca.cer

host=$(hostname)
san="DNS:localhost,DNS:$host,DNS:$host.local,IP:127.0.0.1"
for ip in $(hostname -I); do
	case "$ip" in *:*) ;; *) san="$san,IP:$ip" ;; esac
done

cat > server.ext <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$san
EOF
openssl req -newkey rsa:2048 -nodes -subj "/CN=Zwifit ($host)" -keyout key.pem -out server.csr 2>/dev/null
# 825 days: the longest validity Apple and some browsers accept for a server certificate.
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 825 -sha256 \
	-extfile server.ext -out cert.pem 2>/dev/null
chmod 600 key.pem
rm -f server.csr server.ext

echo "Server certificate for: $san"
echo "CA to trust on other devices: $dir/zwifit-ca.cer"
echo "settings.json → server.tls: { \"certPath\": \"$dir/cert.pem\", \"keyPath\": \"$dir/key.pem\", \"port\": 1338 }"
