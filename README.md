# 🎨 Threedify

**Threedify** é um aplicativo de **modelagem 3D, renderização e animação**, desenvolvido em **JavaScript**, projetado para rodar tanto **na Web** quanto **no Android**.  
O objetivo do projeto é **abranger a maior parte da arquitetura de um software 3D moderno**, inspirado em ferramentas como o **Blender**, mas com foco em simplicidade, portabilidade e controle total do pipeline gráfico.

---

## 🚀 Visão Geral

O Threedify não é apenas um visualizador 3D.  
Ele é estruturado como uma **plataforma completa de criação**, com módulos bem definidos para:

- 🧱 **Modelagem**
- 🎥 **Renderização**
- 🎞️ **Animação**
- ⚙️ **Arquitetura extensível**

O projeto foi pensado desde o início para **crescer**, permitindo a adição futura de novos sistemas como física, nós, shading avançado e simulação.

---

## ✨ Funcionalidades Atuais

### 🧱 Modelagem 3D
- Criação e edição de geometria
- Manipulação básica de vértices, arestas e faces
- Estrutura preparada para edição não destrutiva

---

### 🎥 Renderização
O Threedify conta atualmente com **dois renderizadores próprios**:

#### 🔹 Laziness Renderer
- Renderizador focado em **simplicidade e performance**
- Ideal para visualização rápida e interação em tempo real
- Arquitetura leve e direta

#### 🔹 IRIS Renderer
- Renderizador mais avançado
- Estrutura preparada para:
  - Iluminação
  - Shading
  - Evolução para técnicas mais realistas
- Base para renderizações de maior qualidade

---

### 🎞️ Animação
- Sistema de animação básica
- Transformações animadas
- Estrutura preparada para:
  - Timeline
  - Keyframes
  - Expansão futura do sistema de animação

---

## 🏗️ Arquitetura do Software

O Threedify foi projetado com uma **arquitetura modular**, semelhante a softwares 3D profissionais:

- Separação clara entre:
  - Cena
  - Objetos
  - Renderizadores
  - Ferramentas
- Pipeline gráfico controlado pelo próprio código
- Estrutura preparada para múltiplos backends de renderização

Essa abordagem facilita:
- Manutenção
- Evolução do código
- Experimentação de novos algoritmos gráficos

---

## 🌍 Plataformas Suportadas

- 🌐 **Web** (HTML5 + JavaScript)
- 📱 **Android** (via WebView / wrapper)

O mesmo código base pode ser utilizado em ambas as plataformas.

---

## 🛠️ Tecnologias Utilizadas

- **JavaScript**
- **HTML5**
- **Canvas / WebGL (dependendo do módulo)**
- Arquitetura gráfica própria (sem engines externas)

---

## 🎯 Objetivos do Projeto

- Criar um software 3D completo feito do zero
- Entender profundamente o funcionamento de:
  - Renderizadores
  - Pipeline gráfico
  - Ferramentas de modelagem
- Evoluir para um ambiente comparável, em conceito, a softwares como:
  - Blender
  - Maya
  - Cinema 4D

---

## 🔮 Futuro do Threedify

Funcionalidades planejadas:

- 🔗 Sistema de nós (Node-based)
- 💡 Iluminação avançada
- 🧠 Materiais e shaders
- 🧲 Física e colisões
- 📦 Sistema de plugins
- 🎬 Animação avançada com keyframes
- 📤 Exportação de modelos
