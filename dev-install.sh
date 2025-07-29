#!/usr/bin/env bash

# dev-install.sh - Install the plugin into dev-vault for development
# Uses hard links so changes to source files are immediately reflected

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SHNAME="md-tight-lists.sh"

# Check if dev-vault is in current directory or parent directory
if [ -d "$SCRIPT_DIR/dev-vault" ]; then
    DEV_VAULT="$SCRIPT_DIR/dev-vault"
elif [ -d "$SCRIPT_DIR/../dev-vault" ]; then
    DEV_VAULT="$SCRIPT_DIR/../dev-vault"
else
    DEV_VAULT="$SCRIPT_DIR/dev-vault"  # Default to current directory
fi
PLUGIN_ID="tightlists-formatter"
PLUGIN_DIR="$DEV_VAULT/.obsidian/plugins/$PLUGIN_ID"

echo "🔧 Installing Tight Lists Formatter plugin for development..."

# Check if dev-vault exists
if [ ! -d "$DEV_VAULT" ]; then
    echo -e "${RED}❌ Error: dev-vault not found at $DEV_VAULT${NC}"
    echo "Please create a dev-vault in the current directory first."
    exit 1
fi

# Create plugin directory if it doesn't exist
if [ ! -d "$PLUGIN_DIR" ]; then
    echo -e "${YELLOW}📁 Creating plugin directory...${NC}"
    mkdir -p "$PLUGIN_DIR"
fi

# Function to ensure that two files are hard-linked
ensure_hardlink() {
    local src="$1"
    local tgt="$2"
    
    # Check if parent file exists
    if [[ ! -f "$src" ]]; then
        echo -e "${RED}✗${NC} Missing: $(basename "$src")"
        return 1
    fi
    
    # Get inodes (will be empty if file doesn't exist)
    local src_inode=$(stat -f %i "$src" 2>/dev/null)
    local tgt_inode=$(stat -f %i "$tgt" 2>/dev/null)
    
    # If files don't have same inode, fix it
    if [[ "$src_inode" != "$tgt_inode" ]]; then
        rm -f "$tgt"  # Remove if it exists
        ln "$src" "$tgt" 2>/dev/null
	if [[ -f "$tgt" ]]; then
	    echo -e "${GREEN}✓${NC} Linked: ${src#$REPO_DIR/} -> ${tgt#$REPO_DIR/}"
	else
	    echo -e "${RED}✗${NC} Error: Failed to link ${tgt#$REPO_DIR/}"
	fi
    else
        echo -e "${GREEN}✓${NC} Already Linked: ${tgt#$REPO_DIR/}"
    fi
}

# Check if we need to build first
if [ ! -f "$SCRIPT_DIR/main.js" ]; then
    echo -e "${YELLOW}🔨 Building plugin first...${NC}"
    cd "$SCRIPT_DIR"
    npm run build
    cd - > /dev/null
fi

echo -e "\n${YELLOW}🔗 Creating hard links...${NC}"

# Link all required files
FILES_TO_LINK=(
    "main.js"
    "manifest.json"
    "styles.css"
    $SHNAME
)

FAILED=0

# First: Link shell script from parent repo directory
if ! ensure_hardlink "$REPO_DIR/$SHNAME" "$SCRIPT_DIR/$SHNAME"; then
    FAILED=1
fi

# Make sure the shell script is executable
if [ -f "$SCRIPT_DIR/$SHNAME" ]; then
    if [ ! -x "$SCRIPT_DIR/$SHNAME" ]; then
        chmod +x "$SCRIPT_DIR/$SHNAME"
        echo -e "${GREEN}✓${NC} Made executable: ${SCRIPT_DIR#$REPO_DIR/}/$SHNAME"
    fi
fi

# Second: Link all the main plugin files
for file in "${FILES_TO_LINK[@]}"; do
    if ! ensure_hardlink "$SCRIPT_DIR/$file" "$PLUGIN_DIR/$file"; then
        FAILED=1
    fi
done

# Make sure the plugin shell script is executable
if [ -f "$PLUGIN_DIR/$SHNAME" ]; then
    if [ ! -x "$PLUGIN_DIR/$SHANME" ]; then
        chmod +x "$PLUGIN_DIR/$SHNAME"
        echo -e "${GREEN}✓${NC} Made executable: ${PLUGIN_DIR#$REPO_DIR/}/$SHNAME"
    fi
fi

# Summary
echo -e "\n${YELLOW}📊 Summary:${NC}"
echo "Plugin directory: $PLUGIN_DIR"
echo "Files linked: ${#FILES_TO_LINK[@]}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ Installation complete!${NC}"
    echo "The plugin files are now hard-linked to your dev-vault."
    echo "Changes to source files will be immediately reflected."
    echo ""
    echo "To start development:"
    echo "  1. Run 'npm run dev' in another terminal for auto-rebuild"
    echo "  2. Enable 'Tight Lists Formatter' in Obsidian settings"
    echo "  3. Hot Reload plugin will auto-reload on changes"
else
    echo -e "\n${RED}⚠️  Installation completed with errors.${NC}"
    echo "Some files could not be linked. Please check the output above."
    exit 1
fi
