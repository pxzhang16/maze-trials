export type TriggerType =
  | 'level_start'
  | 'robot_switch'
  | 'before_tow'
  | 'before_long_push'
  | 'rescuing_r3'
  | 'level_clear';

export interface MomentSemantic {
  attachedBox?: 'red_r3' | 'normal';
  pushTarget?: 'red_r3' | 'normal' | 'none';
  switchReason?: 'next_robot_attached' | 'next_robot_walks' | 'unknown';
}

export interface DialogueMoment {
  triggerActionIndex: number;
  trigger: TriggerType;
  context: {
    activeRobot: 'R1' | 'R2';
    upcomingActions: string;
    semantic?: MomentSemantic;
  };
}

export interface DialogueLine {
  speaker: 'R1' | 'R2';
  line: string;
}
