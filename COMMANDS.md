# ServiceFinanceAnt Command Reference

A single place for common commands: local dev, git workflow, and EC2 deploy/debug.

## 0) One-time setup (optional but recommended)

```zsh
# From repo root
cd /Users/lezdev/Desktop/Williams/ServiceFinanceAnt

# Convenience vars for this shell session
export SF_REPO="/Users/lezdev/Desktop/Williams/ServiceFinanceAnt"
export SF_EC2_HOST="ec2-user@18.220.241.84"
export SF_EC2_KEY="/Users/lezdev/Downloads/Boxer EC2 Key.pem"
```

You can add those `export` lines to `~/.zshrc` if you want them always available.

---

## 1) Daily local workflow

```zsh
cd "$SF_REPO"
git pull --ff-only
```

### Backend type-check/build

```zsh
cd "$SF_REPO/backend"
npx tsc --noEmit
npm run build
```

### Mobile type-check

```zsh
cd "$SF_REPO/mobile"
npx tsc --noEmit
```

---

## 2) Git commit + push

```zsh
cd "$SF_REPO"
git status --short

git add -A
git commit -m "your commit message"
git push origin main
```

### Quick log

```zsh
cd "$SF_REPO"
git log --oneline -10
```

---

## 3) Connect to EC2

```zsh
ssh -i "$SF_EC2_KEY" "$SF_EC2_HOST"
```

### Quick non-interactive check

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" 'hostname; whoami; pwd'
```

---

## 4) Deploy latest `main` to EC2

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" '
  cd ~/BoxerSolutions &&
  git pull --ff-only &&
  cd backend &&
  npm run build &&
  sudo systemctl restart servicefinance-api &&
  sleep 4 &&
  systemctl is-active servicefinance-api &&
  curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:4000/health &&
  git log --oneline -1
'
```

---

## 5) EC2 service operations

### Service status / restart

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" 'systemctl status servicefinance-api --no-pager | cat'
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" 'sudo systemctl restart servicefinance-api && systemctl is-active servicefinance-api'
```

### App logs (systemd + app file)

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" 'sudo journalctl -u servicefinance-api --since "-30 min" --no-pager | tail -120'
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" 'tail -n 120 ~/BoxerSolutions/backend/app.log'
```

---

## 6) North / EPX payment troubleshooting

### Tail certification log

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" 'tail -c 12000 ~/BoxerSolutions/backend/logs/north-cert.log | tail -240'
```

### Filter for embedded session + token sale/refund/reversal

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" '
  grep -E "STORAGE session create|SALE session create|session status|TOKEN SALE|REFUND|REVERSAL|VOID" \
  ~/BoxerSolutions/backend/logs/north-cert.log | tail -120
'
```

### Find recent failures in app logs

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" '
  grep -iE "payment failed|declined|north|epx|checkout" ~/BoxerSolutions/backend/app.log | tail -120
'
```

### Extract certification samples for North

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" '
  awk "/^====/{block=\"\"} {block=block\"\n\"\$0} /STORAGE session create|TOKEN SALE|REFUND|REVERSAL|VOID|SALE session create/{keep=1} /^$/{if(keep){print block} keep=0}" \
  ~/BoxerSolutions/backend/logs/north-cert.log
' > north-cert-samples.txt
```

(If the awk one-liner proves fragile, `tail -c 200000 …/north-cert.log > north-cert-samples.txt` and trim by hand is acceptable.)

---

## 7) Useful local searches

```zsh
cd "$SF_REPO"

# Payment integration references
grep -rn --include='*.ts' --include='*.tsx' -E "EPX|North|embedded|token/sale|refund|reversal|aci_ext|MIT|CIT" backend/src mobile/app mobile/src

# Agreement signing flow references
grep -rn --include='*.ts' --include='*.tsx' -E "agreement|sign/pay|onPaymentComplete|storage-session|storage-confirm" backend/src mobile/app
```

---

## 8) Optional: one-command deploy function for zsh

Add this function to `~/.zshrc`:

```zsh
sf_deploy_ec2() {
  ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" '
    cd ~/BoxerSolutions &&
    git pull --ff-only &&
    cd backend &&
    npm run build &&
    sudo systemctl restart servicefinance-api &&
    sleep 4 &&
    systemctl is-active servicefinance-api &&
    curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:4000/health &&
    git log --oneline -1
  '
}
```

Then run:

```zsh
source ~/.zshrc
sf_deploy_ec2
```

---

## 9) Fast checklist before/after deploy

### Before

```zsh
cd "$SF_REPO"
git status --short
cd "$SF_REPO/backend" && npx tsc --noEmit
```

### After

```zsh
ssh -i "$SF_EC2_KEY" -o BatchMode=yes "$SF_EC2_HOST" '
  systemctl is-active servicefinance-api &&
  curl -s -o /dev/null -w "health: %{http_code}\n" http://localhost:4000/health &&
  cd ~/BoxerSolutions && git rev-parse --short HEAD
'
```

