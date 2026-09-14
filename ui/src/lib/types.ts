export type Sport = "Bike" | "Run" | "Swim" | "Recovery"
export type Risk = "low" | "medium" | "high"
export interface Workout { id:string; day:string; date:string; sport:Sport; title:string; duration:string; goal:string; details:string; status:"completed"|"today"|"upcoming"; risk:Risk; changed?:boolean; load?:number; recommendation?:string }
export interface CoachDecision { summary:string; risk_level:Risk; reason:string; recommendation:string; proposed_trainingpeaks_change:string|null; needs_user_approval:boolean; short_message_to_user:string; pre_activity_comment:string; workout_description:string }
