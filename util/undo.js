// undo.js

class CommandManager {
  constructor() {
    this.history = []; // Pilha de comandos executados
    this.currentIndex = -1; // Índice atual na história
    this.maxHistorySize = 15; // Limite de comandos na história
    
    this.initializeButtons();
    this.updateButtonStates();
  }
  
  /**
   * Inicializa os botões de undo/redo
   */
  initializeButtons() {
    const undoBtn = document.getElementById('undo');
    const redoBtn = document.getElementById('redo');
    
    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.undo());
    }
    
    if (redoBtn) {
      redoBtn.addEventListener('click', () => this.redo());
    }
    
    // Atalhos de teclado
    document.addEventListener('keydown', (e) => {
      // Ctrl+Z ou Cmd+Z para undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }
      // Ctrl+Shift+Z ou Cmd+Shift+Z para redo
      else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        this.redo();
      }
      // Ctrl+Y ou Cmd+Y para redo (alternativo)
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        this.redo();
      }
    });
  }
  
  /**
   * Executa um comando e adiciona ao histórico
   * @param {Command} command - Objeto comando com métodos execute() e undo()
   */
  execute(command) {
    try {
      // Remove comandos após o índice atual (quando fazemos algo novo após um undo)
      this.history = this.history.slice(0, this.currentIndex + 1);
      
      // Executa o comando
      command.execute();
      
      // Adiciona ao histórico
      this.history.push(command);
      this.currentIndex++;
      
      // Limita o tamanho do histórico
      if (this.history.length > this.maxHistorySize) {
        this.history.shift();
        this.currentIndex--;
      }
      
      this.updateButtonStates();
      
      console.log(`Comando executado: ${command.name || 'sem nome'}`);
    } catch (error) {
      console.error('Erro ao executar comando:', error);
    }
  }
  
  /**
   * Desfaz o último comando
   */
  undo() {
    if (!this.canUndo()) {
      console.log('Nada para desfazer');
      return;
    }
    
    try {
      const command = this.history[this.currentIndex];
      command.undo();
      this.currentIndex--;
      
      this.updateButtonStates();
      
      console.log(`Comando desfeito: ${command.name || 'sem nome'}`);
    } catch (error) {
      console.error('Erro ao desfazer comando:', error);
    }
  }
  
  /**
   * Refaz o próximo comando
   */
  redo() {
    if (!this.canRedo()) {
      console.log('Nada para refazer');
      return;
    }
    
    try {
      this.currentIndex++;
      const command = this.history[this.currentIndex];
      command.execute();
      
      this.updateButtonStates();
      
      console.log(`Comando refeito: ${command.name || 'sem nome'}`);
    } catch (error) {
      console.error('Erro ao refazer comando:', error);
      this.currentIndex--;
    }
  }
  
  /**
   * Verifica se pode desfazer
   */
  canUndo() {
    return this.currentIndex >= 0;
  }
  
  /**
   * Verifica se pode refazer
   */
  canRedo() {
    return this.currentIndex < this.history.length - 1;
  }
  
  /**
   * Atualiza o estado visual dos botões
   */
  updateButtonStates() {
    const undoBtn = document.getElementById('undo');
    const redoBtn = document.getElementById('redo');
    
    if (undoBtn) {
      undoBtn.disabled = !this.canUndo();
      undoBtn.style.opacity = this.canUndo() ? '1' : '0.5';
      undoBtn.style.cursor = this.canUndo() ? 'pointer' : 'not-allowed';
    }
    
    if (redoBtn) {
      redoBtn.disabled = !this.canRedo();
      redoBtn.style.opacity = this.canRedo() ? '1' : '0.5';
      redoBtn.style.cursor = this.canRedo() ? 'pointer' : 'not-allowed';
    }
  }
  
  /**
   * Limpa todo o histórico
   */
  clear() {
    this.history = [];
    this.currentIndex = -1;
    this.updateButtonStates();
    console.log('Histórico limpo');
  }
  
  /**
   * Retorna informações sobre o histórico
   */
  getHistoryInfo() {
    return {
      total: this.history.length,
      currentIndex: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      commands: this.history.map(cmd => cmd.name || 'sem nome')
    };
  }
}

/**
 * Classe base para comandos
 * Todos os comandos devem herdar desta classe e implementar execute() e undo()
 */
class Command {
  constructor(name) {
    this.name = name;
  }
  
  execute() {
    throw new Error('O método execute() deve ser implementado');
  }
  
  undo() {
    throw new Error('O método undo() deve ser implementado');
  }
}

// Instância global do gerenciador de comandos
const commandManager = new CommandManager();