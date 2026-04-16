#!/bin/bash
# 에이전트 팀 상태 모니터 (상단 패널용)
# 각 팀의 상태 파일을 읽어서 실시간 표시

STATUS_DIR="/tmp/agent-team-status"
mkdir -p "$STATUS_DIR"

# 초기 상태 파일 생성
for team in planning backend frontend qa; do
  if [ ! -f "$STATUS_DIR/$team.status" ]; then
    echo "⏸  대기중" > "$STATUS_DIR/$team.status"
  fi
done

BOLD="\033[1m"
DIM="\033[2m"
RESET="\033[0m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
MAGENTA="\033[35m"
WHITE="\033[37m"
BG_DARK="\033[48;5;236m"

draw_dashboard() {
  clear
  local cols=$(tput cols)
  local line=$(printf '─%.0s' $(seq 1 $cols))

  echo -e "${BOLD}${CYAN}"
  echo "  ╔══════════════════════════════════════════════════════════════╗"
  echo "  ║          🏢  Agent Team Dashboard  —  Sales KPI System     ║"
  echo "  ╚══════════════════════════════════════════════════════════════╝"
  echo -e "${RESET}"

  # 워크플로우 표시
  echo -e "  ${DIM}워크플로우: 팀장 지시 → 기획 → 백엔드 → 프론트엔드 → QA → 보고${RESET}"
  echo ""

  # 각 팀 상태
  local planning_status=$(cat "$STATUS_DIR/planning.status" 2>/dev/null || echo "⏸  대기중")
  local backend_status=$(cat "$STATUS_DIR/backend.status" 2>/dev/null || echo "⏸  대기중")
  local frontend_status=$(cat "$STATUS_DIR/frontend.status" 2>/dev/null || echo "⏸  대기중")
  local qa_status=$(cat "$STATUS_DIR/qa.status" 2>/dev/null || echo "⏸  대기중")

  printf "  ${BOLD}${YELLOW}📋 기획팀${RESET}      │ %s\n" "$planning_status"
  printf "  ${BOLD}${GREEN}⚙️  백엔드팀${RESET}    │ %s\n" "$backend_status"
  printf "  ${BOLD}${CYAN}🎨 프론트엔드팀${RESET} │ %s\n" "$frontend_status"
  printf "  ${BOLD}${MAGENTA}🔍 QA팀${RESET}        │ %s\n" "$qa_status"

  echo ""
  echo -e "  ${DIM}── 상태 업데이트: echo '내용' > /tmp/agent-team-status/<team>.status ──${RESET}"
  echo -e "  ${DIM}── 팀: planning, backend, frontend, qa                              ──${RESET}"
  echo -e "  ${DIM}── 하단 패널에서 각 팀 에이전트가 실행 중입니다 (Ctrl+B → 방향키 이동) ──${RESET}"
}

# 메인 루프: 2초마다 갱신
while true; do
  draw_dashboard
  sleep 2
done
