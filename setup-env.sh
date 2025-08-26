#!/bin/bash
echo "Configuration de l'environnement EcoScope"
echo "======================================"

if [ -f ".env" ]; then
    read -p "Le fichier .env existe déjà. Voulez-vous le conserver ? (o/N) " KEEP_ENV
    if [[ $KEEP_ENV =~ ^[Nn]$ ]]; then
        cp .env .env.backup
        echo "Une sauvegarde a été créée : .env.backup"
        rm .env
    fi
fi

# Valeurs par défaut
PORT=5002
NODE_ENV=development
VITE_API_URL="http://localhost:5002"

# Configuration interactive
read -p "Port du serveur [5002]: " INPUT_PORT
[[ ! -z "$INPUT_PORT" ]] && PORT=$INPUT_PORT

read -p "Environnement (development/production) [development]: " INPUT_NODE_ENV
[[ ! -z "$INPUT_NODE_ENV" ]] && NODE_ENV=$INPUT_NODE_ENV

read -p "URL de l'API [http://localhost:5002]: " INPUT_VITE_API_URL
[[ ! -z "$INPUT_VITE_API_URL" ]] && VITE_API_URL=$INPUT_VITE_API_URL

# Création du fichier
cat > .env << EOF
# Configuration du serveur
PORT=$PORT
NODE_ENV=$NODE_ENV

# Configuration du frontend
VITE_API_URL=$VITE_API_URL
EOF

echo "Configuration terminée !"
