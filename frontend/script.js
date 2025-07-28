class PixelCanvas {
    constructor() {
        this.canvas = document.getElementById('pixel-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.container = document.getElementById('canvas-container');

        // Canvas settings
        this.gridSize = 3000;
        this.pixelSize = 1;
        this.zoom = 0.3;
        this.minZoom = 0.1;
        this.maxZoom = 40;

        // Pan settings
        this.viewportX = 0;
        this.viewportY = 0;
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        // Drawing settings
        this.selectedColor = '#000000';
        this.isErasing = false;
        this.isColorPickerMode = false;
        this.pixels = new Map();
        this.pixelMetadata = new Map();
        this.recentColors = JSON.parse(localStorage.getItem('recentColors') || JSON.stringify(['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF']));

        // WebSocket
        this.ws = null;
        this.connected = false;
        this.userCount = 0;

        // Touch handling
        this.touches = [];
        this.lastTouchDistance = 0;
        this.touchStartTime = 0;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchMoved = false;

        // Pixel info hover
        this.pixelInfoTimeout = null;

        // User name
        this.userName = localStorage.getItem('pixelUserName') || '';
        if (!this.userName) {
            this.initNameModal();
        }

        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupColorPicker();
        this.connectWebSocket();
        this.loadPixels();
        this.centerCanvas();
        this.render();
    }

    initNameModal() {
        const modal = document.getElementById('name-modal');
        const input = document.getElementById('username-input');
        const submitBtn = document.getElementById('submit-name');

        modal.style.display = 'block';
        input.focus();

        const handleSubmit = () => {
            const name = input.value.trim();
            if (name) {
                this.userName = name;
                localStorage.setItem('pixelUserName', name);
                modal.style.display = 'none';
                submitBtn.removeEventListener('click', handleSubmit);
                input.removeEventListener('keypress', handleKeyPress);
            } else {
                alert('Please enter a valid name');
                input.focus();
            }
        };

        const handleKeyPress = (e) => {
            if (e.key === 'Enter') {
                handleSubmit();
            }
        };

        submitBtn.addEventListener('click', handleSubmit);
        input.addEventListener('keypress', handleKeyPress);
    }

    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        const rect = this.container.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.render();
    }

    centerCanvas() {
        this.viewportX = 0;
        this.viewportY = 0;
        this.render();
    }

    setupEventListeners() {
        // Eraser tool
        document.getElementById('eraser-btn').addEventListener('click', () => {
            this.isErasing = !this.isErasing;
            document.getElementById('eraser-btn').classList.toggle('active', this.isErasing);
            document.getElementById('selected-color').style.backgroundColor = this.isErasing ? 'transparent' : this.selectedColor;
        });

        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Touch events
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: false });
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e));

        // Leaderboard button
        document.getElementById('leaderboard-btn').addEventListener('click', async () => {
            const modal = document.getElementById('leaderboard-modal');
            const tableBody = document.getElementById('leaderboard-table').querySelector('tbody');
            tableBody.innerHTML = ''; // Clear previous data

            try {
                const response = await fetch('http://localhost:3002/api/pixels/leaderboard');
                if (!response.ok) throw new Error('Failed to fetch leaderboard');
                const leaderboard = await response.json();

                leaderboard.forEach((entry) => {
                    const row = document.createElement('tr');
                    const nameCell = document.createElement('td');
                    const countCell = document.createElement('td');

                    nameCell.textContent = entry.name;
                    countCell.textContent = entry.pixelCount;

                    row.appendChild(nameCell);
                    row.appendChild(countCell);
                    tableBody.appendChild(row);
                });

                modal.style.display = 'block';
            } catch (error) {
                console.error('Error loading leaderboard:', error);
                alert('Failed to load leaderboard');
            }
        });

        document.getElementById('close-leaderboard').addEventListener('click', () => {
            document.getElementById('leaderboard-modal').style.display = 'none';
        });
    }

    setupColorPicker() {
        // Color picker button
        document.getElementById('color-wheel-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const modal = document.getElementById('color-picker-modal');
            const colorWheel = document.getElementById('color-wheel');
            const hexInput = document.getElementById('color-hex-input');
            
            colorWheel.value = this.selectedColor;
            hexInput.value = this.selectedColor;
            modal.style.display = 'block';
            
            colorWheel.addEventListener('input', () => {
                hexInput.value = colorWheel.value;
            });
            
            hexInput.addEventListener('input', (e) => {
                if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
                    colorWheel.value = e.target.value;
                }
            });

            const confirmHandler = () => {
                if (/^#[0-9A-F]{6}$/i.test(hexInput.value)) {
                    this.selectedColor = hexInput.value.toUpperCase();
                    document.getElementById('selected-color').style.backgroundColor = this.selectedColor;
                    this.isErasing = false;
                    document.getElementById('eraser-btn').classList.remove('active');
                    this.addRecentColor(this.selectedColor);
                }
                modal.style.display = 'none';
                document.getElementById('confirm-color-btn').removeEventListener('click', confirmHandler);
            };

            document.getElementById('confirm-color-btn').addEventListener('click', confirmHandler);

            // Close modal when clicking outside
            const modalClickHandler = (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                    modal.removeEventListener('click', modalClickHandler);
                    document.getElementById('confirm-color-btn').removeEventListener('click', confirmHandler);
                }
            };
            modal.addEventListener('click', modalClickHandler);
        });

        // Color picker mode button
        document.getElementById('color-picker-btn').addEventListener('click', () => {
            this.toggleColorPickerMode();
        });
    }

    addRecentColor(color) {
        this.recentColors = this.recentColors.filter(c => c !== color);
        this.recentColors.unshift(color);
        if (this.recentColors.length > 10) {
            this.recentColors = this.recentColors.slice(0, 10);
        }
        localStorage.setItem('recentColors', JSON.stringify(this.recentColors));
    }

    toggleColorPickerMode() {
        this.isColorPickerMode = !this.isColorPickerMode;
        const pickerBtn = document.getElementById('color-picker-btn');
        pickerBtn.classList.toggle('active', this.isColorPickerMode);
        this.canvas.style.cursor = this.isColorPickerMode ? 'crosshair' : '';

        if (this.isColorPickerMode) {
            const indicator = document.createElement('div');
            indicator.className = 'color-picker-mode';
            indicator.textContent = 'Click on a pixel to pick its color';
            indicator.id = 'color-picker-indicator';
            document.body.appendChild(indicator);
        } else {
            const indicator = document.getElementById('color-picker-indicator');
            if (indicator) {
                indicator.remove();
            }
        }
    }

    handlePixelColorPick(x, y) {
        const pixelKey = `${x},${y}`;
        if (this.pixels.has(pixelKey)) {
            const color = this.pixels.get(pixelKey);
            this.selectedColor = color;
            document.getElementById('selected-color').style.backgroundColor = color;
            this.addRecentColor(color);
            this.isErasing = false;
            document.getElementById('eraser-btn').classList.remove('active');

            const indicator = document.getElementById('color-picker-indicator');
            if (indicator) {
                indicator.textContent = `Picked color: ${color}`;
                setTimeout(() => {
                    if (this.isColorPickerMode && indicator) {
                        indicator.textContent = 'Click on a pixel to pick its color';
                    }
                }, 1000);
            }
        }
    }

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (e.button === 0) {
            const gridPos = this.screenToGrid(x, y);
            if (this.isValidGridPosition(gridPos.x, gridPos.y)) {
                if (this.isColorPickerMode) {
                    this.handlePixelColorPick(gridPos.x, gridPos.y);
                    this.toggleColorPickerMode();
                } else {
                    this.placePixel(gridPos.x, gridPos.y);
                }
            }
        } else if (e.button === 2) {
            this.startPan(x, y);
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const gridPos = this.screenToGrid(x, y);
        document.getElementById('coordinates').textContent = `${gridPos.x}, ${gridPos.y}`;

        this.updatePixelInfoPosition(e.clientX, e.clientY);

        if (this.pixelMetadata.has(`${gridPos.x},${gridPos.y}`)) {
            this.showPixelInfo(gridPos.x, gridPos.y);
        } else {
            this.hidePixelInfo();
        }

        if (this.isPanning) {
            this.updatePan(x, y);
        }
    }

    handleMouseUp(e) {
        if (e.button === 2) {
            this.endPan();
        }
    }

    handleMouseLeave() {
        this.hidePixelInfo();
        if (this.isPanning) {
            this.endPan();
        }
    }

    handleWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.zoomAt(mouseX, mouseY, delta);
    }

    handleTouchStart(e) {
        e.preventDefault();
        this.touches = Array.from(e.touches);

        if (this.touches.length === 1) {
            const touch = this.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            this.touchStartTime = Date.now();
            this.touchStartX = x;
            this.touchStartY = y;
            this.touchMoved = false;

            if (this.isColorPickerMode) {
                const gridPos = this.screenToGrid(x, y);
                if (this.isValidGridPosition(gridPos.x, gridPos.y)) {
                    this.handlePixelColorPick(gridPos.x, gridPos.y);
                    this.toggleColorPickerMode();
                }
                return;
            }
        } else if (this.touches.length === 2) {
            this.lastTouchDistance = this.getTouchDistance();
            this.touchStartTime = null;
        }
    }

    handleTouchMove(e) {
        e.preventDefault();
        if (this.isColorPickerMode) return;

        this.touches = Array.from(e.touches);

        if (this.touches.length === 1) {
            const touch = this.touches[0];
            const rect = this.canvas.getBoundingClientRect();
            const x = touch.clientX - rect.left;
            const y = touch.clientY - rect.top;

            const moveDistance = Math.sqrt(
                Math.pow(x - this.touchStartX, 2) +
                Math.pow(y - this.touchStartY, 2)
            );

            if (moveDistance > 10) {
                this.touchMoved = true;

                if (!this.isPanning) {
                    this.startPan(this.touchStartX, this.touchStartY);
                }

                this.updatePan(x, y);
            }
        } else if (this.touches.length === 2) {
            const currentDistance = this.getTouchDistance();
            if (this.lastTouchDistance > 0) {
                const scale = currentDistance / this.lastTouchDistance;

                const centerX = (this.touches[0].clientX + this.touches[1].clientX) / 2;
                const centerY = (this.touches[0].clientY + this.touches[1].clientY) / 2;
                const rect = this.canvas.getBoundingClientRect();

                this.zoomAt(centerX - rect.left, centerY - rect.top, scale);
            }
            this.lastTouchDistance = currentDistance;
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();
        if (this.isColorPickerMode) return;

        this.touches = Array.from(e.touches);

        if (this.touches.length === 0) {
            if (this.isPanning) {
                this.endPan();
            } else if (!this.touchMoved && this.touchStartTime) {
                const timeDiff = Date.now() - this.touchStartTime;
                if (timeDiff < 300) {
                    const gridPos = this.screenToGrid(this.touchStartX, this.touchStartY);
                    if (this.isValidGridPosition(gridPos.x, gridPos.y)) {
                        this.placePixel(gridPos.x, gridPos.y);
                    }
                }
            }

            this.touchStartTime = null;
            this.touchMoved = false;
            this.lastTouchDistance = 0;
        } else if (this.touches.length < 2) {
            this.lastTouchDistance = 0;
        }
    }

    getTouchDistance() {
        if (this.touches.length < 2) return 0;
        const dx = this.touches[0].clientX - this.touches[1].clientX;
        const dy = this.touches[0].clientY - this.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    startPan(x, y) {
        this.isPanning = true;
        this.lastPanX = x;
        this.lastPanY = y;
        this.container.classList.add('panning');
    }

    updatePan(x, y) {
        if (!this.isPanning) return;

        const dx = x - this.lastPanX;
        const dy = y - this.lastPanY;

        this.viewportX += dx;
        this.viewportY += dy;

        this.clampOffsets();

        this.lastPanX = x;
        this.lastPanY = y;

        this.render();
    }

    endPan() {
        this.isPanning = false;
        this.container.classList.remove('panning');
    }

    zoomAt(x, y, scale) {
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * scale));

        if (newZoom !== this.zoom) {
            const gridPos = this.screenToGrid(x, y);
            this.zoom = newZoom;
            const newScreenPos = this.gridToScreen(gridPos.x, gridPos.y);

            this.viewportX += (x - newScreenPos.x);
            this.viewportY += (y - newScreenPos.y);

            this.clampOffsets();

            document.getElementById('zoom-level').textContent = `${Math.round(this.zoom * 100)}%`;
            this.render();
        }
    }

    screenToGrid(screenX, screenY) {
        const canvasWidth = this.gridSize * this.pixelSize * this.zoom;
        const canvasHeight = this.gridSize * this.pixelSize * this.zoom;
        const centerX = (this.canvas.width - canvasWidth) / 2;
        const centerY = (this.canvas.height - canvasHeight) / 2;

        const worldX = (screenX - centerX - this.viewportX) / this.zoom;
        const worldY = (screenY - centerY - this.viewportY) / this.zoom;

        return {
            x: Math.floor(worldX / this.pixelSize),
            y: Math.floor(worldY / this.pixelSize)
        };
    }

    gridToScreen(gridX, gridY) {
        const canvasWidth = this.gridSize * this.pixelSize * this.zoom;
        const canvasHeight = this.gridSize * this.pixelSize * this.zoom;
        const centerX = (this.canvas.width - canvasWidth) / 2;
        const centerY = (this.canvas.height - canvasHeight) / 2;

        return {
            x: centerX + (gridX * this.pixelSize) * this.zoom + this.viewportX,
            y: centerY + (gridY * this.pixelSize) * this.zoom + this.viewportY
        };
    }

    clampOffsets() {
        const canvasWidth = this.gridSize * this.pixelSize * this.zoom;
        const canvasHeight = this.gridSize * this.pixelSize * this.zoom;

        const maxViewportX = canvasWidth / 2;
        const maxViewportY = canvasHeight / 2;

        this.viewportX = Math.max(-maxViewportX, Math.min(maxViewportX, this.viewportX));
        this.viewportY = Math.max(-maxViewportY, Math.min(maxViewportY, this.viewportY));
    }

    isValidGridPosition(x, y) {
        return x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize;
    }

    async placePixel(x, y) {
        try {
            if (this.isErasing) {
                await this.deletePixelFromServer(x, y);
            } else {
                await this.sendPixelToServer(x, y, this.selectedColor);
            }
        } catch (error) {
            console.error('Failed to place pixel:', error);
        }
    }

    async sendPixelToServer(x, y, color) {
        const response = await fetch('http://localhost:3002/api/pixels', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                x,
                y,
                color,
                insertedBy: this.userName
            })
        });

        if (!response.ok) {
            throw new Error('Failed to place pixel');
        }
    }

    async deletePixelFromServer(x, y) {
        const response = await fetch('http://localhost:/3002/api/pixels', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ x, y })
        });

        if (!response.ok) {
            throw new Error('Failed to delete pixel');
        }
    }

    updatePixel(x, y, color, metadata = null) {
        this.pixels.set(`${x},${y}`, color);

        if (metadata) {
            this.pixelMetadata.set(`${x},${y}`, metadata);
        } else if (this.pixelMetadata.has(`${x},${y}`)) {
            const existing = this.pixelMetadata.get(`${x},${y}`);
            existing.color = color;
            this.pixelMetadata.set(`${x},${y}`, existing);
        }

        this.renderPixel(x, y, color);
    }

    deletePixel(x, y) {
        this.pixels.delete(`${x},${y}`);
        this.pixelMetadata.delete(`${x},${y}`);
        this.clearPixel(x, y);
    }

    showPixelInfo(x, y) {
        if (this.pixelInfoTimeout) {
            clearTimeout(this.pixelInfoTimeout);
            this.pixelInfoTimeout = null;
        }

        const pixelKey = `${x},${y}`;
        if (this.pixelMetadata.has(pixelKey)) {
            this.pixelInfoTimeout = setTimeout(() => {
                const data = this.pixelMetadata.get(pixelKey);
                const pixelInfo = document.getElementById('pixel-info');

                pixelInfo.innerHTML = `
                    <div class="pixel-color" style="background-color: ${data.color};"></div>
                    <div class="pixel-details">
                        <div class="pixel-coords"><strong>Position:</strong> ${x}, ${y}</div>
                        <div class="pixel-author"><strong>Placed by:</strong> ${data.insertedBy || 'Anonymous'}</div>
                        <div class="pixel-time"><strong>Last updated:</strong> ${new Date(data.updatedAt).toLocaleString()}</div>
                    </div>
                `;
                pixelInfo.style.display = 'block';
            }, 1000);
        }
    }

    hidePixelInfo() {
        if (this.pixelInfoTimeout) {
            clearTimeout(this.pixelInfoTimeout);
            this.pixelInfoTimeout = null;
        }

        const pixelInfo = document.getElementById('pixel-info');
        pixelInfo.style.display = 'none';
    }

    updatePixelInfoPosition(x, y) {
        const pixelInfo = document.getElementById('pixel-info');
        const rect = pixelInfo.getBoundingClientRect();
        
        let posX = x + 10;
        let posY = y + 10;
        
        if (posX + rect.width > window.innerWidth) {
            posX = window.innerWidth - rect.width - 10;
        }
        
        if (posY + rect.height > window.innerHeight) {
            posY = window.innerHeight - rect.height - 10;
        }
        
        pixelInfo.style.left = `${posX}px`;
        pixelInfo.style.top = `${posY}px`;
    }

    drawGrid() {
        // Plain white background
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    render() {
        this.drawGrid();
        this.pixels.forEach((color, key) => {
            const [x, y] = key.split(',').map(Number);
            this.renderPixel(x, y, color);
        });
    }

    renderPixel(gridX, gridY, color) {
        const screenPos = this.gridToScreen(gridX, gridY);
        const size = this.pixelSize * this.zoom;
        this.ctx.fillStyle = color;
        this.ctx.fillRect(screenPos.x, screenPos.y, size, size);
    }

    clearPixel(gridX, gridY) {
        const screenPos = this.gridToScreen(gridX, gridY);
        const size = this.pixelSize * this.zoom;
        this.ctx.clearRect(screenPos.x, screenPos.y, size, size);
    }

    connectWebSocket() {
        const wsUrl = 'ws://localhost:3002';

        console.log('Connecting to WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.connected = true;
            this.updateConnectionStatus();
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.connected = false;
            this.updateConnectionStatus();
            setTimeout(() => this.connectWebSocket(), 3002);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.connected = false;
            this.updateConnectionStatus();
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
        };
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'pixel_update':
                this.updatePixel(data.x, data.y, data.color, {
                    color: data.color,
                    insertedBy: data.insertedBy,
                    updatedAt: data.updatedAt
                });
                break;
            case 'pixel_delete':
                this.deletePixel(data.x, data.y);
                break;
            case 'user_count':
                this.userCount = data.count;
                document.getElementById('users-count').textContent = `${data.count} online`;
                break;
        }
    }

    updateConnectionStatus() {
        const statusEl = document.querySelector('.status-indicator');
        const connectionText = document.getElementById('users-count');

        if (!statusEl || !connectionText) return;

        if (this.connected) {
            statusEl.className = 'status-indicator connected';
        } else {
            statusEl.className = 'status-indicator disconnected';
            connectionText.textContent = 'offline';
        }
    }

    async loadPixels() {
        try {
            const response = await fetch('http://localhost:3002/api/pixels');
            const pixels = await response.json();

            this.pixels.clear();
            this.pixelMetadata.clear();

            pixels.forEach(pixel => {
                this.pixels.set(`${pixel.x},${pixel.y}`, pixel.color);
                this.pixelMetadata.set(`${pixel.x},${pixel.y}`, {
                    color: pixel.color,
                    insertedBy: pixel.insertedBy,
                    updatedAt: pixel.updatedAt
                });
            });

            this.render();
        } catch (error) {
            console.error('Failed to load pixels:', error);
        }
    }
}

class ChatWidget {
    constructor() {
        this.widget = document.querySelector('.chat-widget');
        this.toggle = document.querySelector('.chat-toggle');
        this.container = document.querySelector('.chat-container');
        this.closeBtn = document.querySelector('.chat-close');
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        this.toggle.addEventListener('click', () => {
            this.widget.classList.toggle('expanded');
        });
        
        this.closeBtn.addEventListener('click', () => {
            this.widget.classList.remove('expanded');
        });
        
        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (this.widget.classList.contains('expanded') && 
                !this.container.contains(e.target) && 
                !this.toggle.contains(e.target)) {
                this.widget.classList.remove('expanded');
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PixelCanvas();
    new ChatWidget();

    // Ensure leaderboard modal is hidden on page load
    const leaderboardModal = document.getElementById('leaderboard-modal');
    leaderboardModal.style.display = 'none';
});