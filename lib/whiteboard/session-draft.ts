import {boardSchema,generatedLessonSchema,type Lesson} from '../../schemas/lesson';
import {validateActions} from './engine';
import {assertMathIntegrity,assertTextIntegrity} from '../ai/math-integrity';
import type {LessonCheckpoint} from './usePlayback';

export const lessonDraftKey=(userId:string,slug:string)=>`fahimni:lesson:${userId}:${slug}`;
export function readLessonDraft(raw:string|null):LessonCheckpoint|null{
 try{
  if(!raw||raw.length>500_000)return null;
  const value=JSON.parse(raw) as LessonCheckpoint;
  const base=boardSchema.parse(value.base),board=boardSchema.parse(value.board);
  for(const object of [...base.objects,...board.objects]){
    assertTextIntegrity(object.content);
    if(object.type==='write_latex')assertMathIntegrity(object.content);
  }
  const lesson=value.lesson;
  generatedLessonSchema.parse({title:lesson.title,mode:lesson.mode,sufficientContext:lesson.sufficientContext,message:lesson.message,assessment:lesson.assessment,segments:lesson.segments.map(s=>({id:s.id,narration:s.narration,goal:s.goal,sourceChunkIds:s.sourceChunkIds,actions:s.actions}))});
  if(!lesson.id||!Array.isArray(lesson.sources)||!lesson.segments.length)return null;
  if(!Number.isInteger(value.index)||value.index<0||value.index>=lesson.segments.length)return null;
  if(!Number.isFinite(value.elapsed)||value.elapsed<0||value.elapsed>600_000)return null;
  if(!Number.isInteger(value.actionIndex)||value.actionIndex<0||value.actionIndex>lesson.segments[value.index].actions.length)return null;
  validateActions(base,lesson.segments,lesson.sources.map(s=>s.image));
  return {...value,lesson:lesson as Lesson,base,board};
 }catch{return null;}
}
