#!/bin/bash
# 에이전트 팀 tmux 대시보드 실행 스크립트
# 상단: 상태 모니터 / 하단: 4개 팀 에이전트 (claude CLI)

SESSION="agent-teams"
PROJECT_DIR="/Users/torder/workspace/salesforce-data-tools"
PROMPTS_DIR="$PROJECT_DIR/scripts/agent-prompts"
STATUS_DIR="/tmp/agent-team-status"

# 상태 디렉토리 초기화
mkdir -p "$STATUS_DIR"
for team in planning backend frontend qa; do
  echo "⏸  대기중" > "$STATUS_DIR/$team.status"
done

# 기존 세션 있으면 종료
tmux has-session -t "$SESSION" 2>/dev/null && tmux kill-session -t "$SESSION"

# 새 세션 생성 (상단 모니터 패널)
tmux new-session -d -s "$SESSION" -x 220 -y 55 \
  "bash $PROJECT_DIR/scripts/agent-status-monitor.sh"

# 상단 패널 이름 설정
tmux rename-window -t "$SESSION" "Dashboard"

# 하단 영역 분할 — 4개 팀 패널
# 먼저 상단/하단 분리 (상단 30%)
tmux split-window -t "$SESSION" -v -p 75 -c "$PROJECT_DIR"

# 하단을 좌/우로 분할
tmux split-window -t "$SESSION:0.1" -h -p 50 -c "$PROJECT_DIR"

# 하단 좌측을 상/하로 분할
tmux split-window -t "$SESSION:0.1" -v -p 50 -c "$PROJECT_DIR"

# 하단 우측을 상/하로 분할
tmux split-window -t "$SESSION:0.3" -v -p 50 -c "$PROJECT_DIR"

# 각 패널에 팀 라벨 + claude 실행 준비
# Pane 0: 상태 모니터 (이미 실행 중)
# Pane 1: 기획팀 (좌상)
# Pane 2: 백엔드팀 (좌하)
# Pane 3: 프론트엔드팀 (우상)
# Pane 4: QA팀 (우하)

# 각 팀 pane에 claude 실행 명령어 전송
launch_agent() {
  local pane=$1
  local team_name=$2
  local prompt_file=$3
  local status_file="$STATUS_DIR/${team_name}.status"

  echo "🚀 실행중" > "$status_file"
  # claude CLI를 시스템 프롬프트와 함께 자동 실행
  tmux send-keys -t "$SESSION:0.$pane" \
    "claude --system-prompt \"\$(cat $prompt_file)\"" \
    Enter
}

# 4개 팀 병렬 실행
launch_agent 1 "planning"  "$PROMPTS_DIR/planning-team.md"
launch_agent 2 "backend"   "$PROMPTS_DIR/backend-team.md"
launch_agent 3 "frontend"  "$PROMPTS_DIR/frontend-team.md"
launch_agent 4 "qa"        "$PROMPTS_DIR/qa-team.md"

# 포커스를 기획팀 패널로 이동 (워크플로우 시작점)
tmux select-pane -t "$SESSION:0.1"

# tmux 연결
tmux attach-session -t "$SESSION"
