-- BrainiLab Backend — Step 7: all 4 Daily Games
-- Run after Steps 1–6.
--
-- Adds:
-- - BrainiWord word pool + daily word assignment
-- - Flag Dash country pool + 30-question daily set
-- - Map Hunt clue pool + 10-question daily set
-- - controlled public fetch/check RPCs
-- - authenticated final-result answer/content verification
-- - automatic generation for every future daily_challenges row
--
-- IMPORTANT:
-- The existing Step 5 Cron does NOT need to change.
-- Its creation of future daily_challenges now triggers generation of
-- BrainiWord + Flag Dash + Map Hunt automatically.

begin;

create extension if not exists pgcrypto;

-- ============================================================
-- CONTENT POOLS
-- ============================================================

create table if not exists public.daily_countries(
  id uuid primary key default gen_random_uuid(),
  iso2 text not null unique,
  country_name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint daily_countries_iso2 check (iso2 ~ '^[A-Z]{2}$')
);

create table if not exists public.map_hunt_clues(
  id uuid primary key default gen_random_uuid(),
  country_id uuid not null references public.daily_countries(id) on delete restrict,
  clue text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint map_hunt_clue_length check (char_length(clue) between 12 and 500)
);

create table if not exists public.brainiword_words(
  id uuid primary key default gen_random_uuid(),
  word text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint brainiword_five_letters check (word ~ '^[A-Z]{5}$')
);

insert into public.daily_countries(iso2,country_name,is_active)
values
('AR','Argentina',true),
('AU','Australia',true),
('AT','Austria',true),
('BE','Belgium',true),
('BR','Brazil',true),
('CA','Canada',true),
('CL','Chile',true),
('CN','China',true),
('CO','Colombia',true),
('HR','Croatia',true),
('CZ','Czechia',true),
('DK','Denmark',true),
('EG','Egypt',true),
('FI','Finland',true),
('FR','France',true),
('DE','Germany',true),
('GR','Greece',true),
('HU','Hungary',true),
('IS','Iceland',true),
('IN','India',true),
('ID','Indonesia',true),
('IE','Ireland',true),
('IL','Israel',true),
('IT','Italy',true),
('JP','Japan',true),
('KE','Kenya',true),
('MY','Malaysia',true),
('MX','Mexico',true),
('MA','Morocco',true),
('NL','Netherlands',true),
('NZ','New Zealand',true),
('NG','Nigeria',true),
('NO','Norway',true),
('PK','Pakistan',true),
('PE','Peru',true),
('PH','Philippines',true),
('PL','Poland',true),
('PT','Portugal',true),
('RO','Romania',true),
('SA','Saudi Arabia',true),
('RS','Serbia',true),
('SG','Singapore',true),
('ZA','South Africa',true),
('KR','South Korea',true),
('ES','Spain',true),
('SE','Sweden',true),
('CH','Switzerland',true),
('TH','Thailand',true),
('TR','Türkiye',true),
('UA','Ukraine',true),
('AE','United Arab Emirates',true),
('GB','United Kingdom',true),
('US','United States',true),
('VN','Vietnam',true),
('DZ','Algeria',true),
('BD','Bangladesh',true),
('BO','Bolivia',true),
('BG','Bulgaria',true),
('CR','Costa Rica',true),
('CU','Cuba',true),
('DO','Dominican Republic',true),
('EC','Ecuador',true),
('EE','Estonia',true),
('ET','Ethiopia',true),
('GH','Ghana',true),
('JM','Jamaica',true),
('JO','Jordan',true),
('KZ','Kazakhstan',true),
('LT','Lithuania',true),
('LU','Luxembourg',true),
('NP','Nepal',true),
('PA','Panama',true),
('PY','Paraguay',true),
('QA','Qatar',true),
('SK','Slovakia',true),
('SI','Slovenia',true),
('LK','Sri Lanka',true),
('TN','Tunisia',true),
('UY','Uruguay',true)
on conflict(iso2) do update
set country_name=excluded.country_name,
    is_active=true;

insert into public.map_hunt_clues(country_id,clue,is_active)
values
((select id from public.daily_countries where iso2='FR'),'This country is home to the Eiffel Tower and the Louvre.',true),
((select id from public.daily_countries where iso2='JP'),'Mount Fuji rises on this island nation in East Asia.',true),
((select id from public.daily_countries where iso2='EG'),'The Great Pyramid of Giza stands in this country.',true),
((select id from public.daily_countries where iso2='BR'),'Rio de Janeiro and much of the Amazon rainforest are in this country.',true),
((select id from public.daily_countries where iso2='AU'),'The Great Barrier Reef lies off the coast of this country.',true),
((select id from public.daily_countries where iso2='CA'),'This country stretches from the Atlantic to the Pacific and includes Toronto.',true),
((select id from public.daily_countries where iso2='IN'),'The Taj Mahal is located in this country.',true),
((select id from public.daily_countries where iso2='IT'),'Rome, Venice and Florence are cities in this country.',true),
((select id from public.daily_countries where iso2='ES'),'Madrid and Barcelona are major cities in this country.',true),
((select id from public.daily_countries where iso2='DE'),'Berlin is the capital of this central European country.',true),
((select id from public.daily_countries where iso2='GB'),'London, Edinburgh, Cardiff and Belfast are within this sovereign state.',true),
((select id from public.daily_countries where iso2='US'),'The Grand Canyon and Yellowstone National Park are in this country.',true),
((select id from public.daily_countries where iso2='MX'),'Chichén Itzá is located on the Yucatán Peninsula in this country.',true),
((select id from public.daily_countries where iso2='PE'),'Machu Picchu is located high in the Andes of this country.',true),
((select id from public.daily_countries where iso2='AR'),'Buenos Aires and Patagonia are in this South American country.',true),
((select id from public.daily_countries where iso2='CL'),'This long, narrow country runs along the Pacific coast of South America.',true),
((select id from public.daily_countries where iso2='NZ'),'Auckland and Wellington are cities in this Pacific country.',true),
((select id from public.daily_countries where iso2='ZA'),'Cape Town and Johannesburg are major cities in this country.',true),
((select id from public.daily_countries where iso2='KE'),'Nairobi is the capital of this East African country.',true),
((select id from public.daily_countries where iso2='MA'),'Marrakesh and Casablanca are cities in this North African country.',true),
((select id from public.daily_countries where iso2='GR'),'Athens and the islands of Santorini and Crete are part of this country.',true),
((select id from public.daily_countries where iso2='PT'),'Lisbon and Porto are major cities in this Atlantic-facing European country.',true),
((select id from public.daily_countries where iso2='NL'),'Amsterdam is famous for canals and bicycles in this country.',true),
((select id from public.daily_countries where iso2='BE'),'Brussels is the capital of this country and hosts major EU institutions.',true),
((select id from public.daily_countries where iso2='CH'),'The Matterhorn and cities such as Zurich and Geneva are in this country.',true),
((select id from public.daily_countries where iso2='AT'),'Vienna and Salzburg are cities in this Alpine country.',true),
((select id from public.daily_countries where iso2='NO'),'This Scandinavian country is known for fjords and has Oslo as its capital.',true),
((select id from public.daily_countries where iso2='SE'),'Stockholm is the capital of this Scandinavian country.',true),
((select id from public.daily_countries where iso2='FI'),'Helsinki is the capital of this Nordic country.',true),
((select id from public.daily_countries where iso2='DK'),'Copenhagen is the capital of this Nordic country.',true),
((select id from public.daily_countries where iso2='IS'),'Reykjavík is the capital of this volcanic North Atlantic island country.',true),
((select id from public.daily_countries where iso2='IE'),'Dublin is the capital of this island country west of Great Britain.',true),
((select id from public.daily_countries where iso2='PL'),'Warsaw and Kraków are major cities in this central European country.',true),
((select id from public.daily_countries where iso2='CZ'),'Prague is the capital of this central European country.',true),
((select id from public.daily_countries where iso2='HU'),'Budapest sits on the Danube in this central European country.',true),
((select id from public.daily_countries where iso2='HR'),'Dubrovnik lies on the Adriatic coast of this country.',true),
((select id from public.daily_countries where iso2='TR'),'Istanbul straddles Europe and Asia in this country.',true),
((select id from public.daily_countries where iso2='TH'),'Bangkok is the capital of this Southeast Asian country.',true),
((select id from public.daily_countries where iso2='VN'),'Hanoi and Ho Chi Minh City are major cities in this country.',true),
((select id from public.daily_countries where iso2='ID'),'Bali and Java are islands in this Southeast Asian country.',true),
((select id from public.daily_countries where iso2='MY'),'Kuala Lumpur is the capital of this Southeast Asian federation.',true),
((select id from public.daily_countries where iso2='PH'),'Manila is the capital of this Southeast Asian archipelago.',true),
((select id from public.daily_countries where iso2='SG'),'This city-state lies at the southern tip of the Malay Peninsula.',true),
((select id from public.daily_countries where iso2='CN'),'The Great Wall crosses northern parts of this country.',true),
((select id from public.daily_countries where iso2='KR'),'Seoul is the capital of this country on the Korean Peninsula.',true),
((select id from public.daily_countries where iso2='NP'),'Mount Everest lies on the border of this Himalayan country and China.',true),
((select id from public.daily_countries where iso2='AE'),'Dubai and Abu Dhabi are cities in this Gulf federation.',true),
((select id from public.daily_countries where iso2='SA'),'Mecca and Riyadh are cities in this Arabian Peninsula country.',true),
((select id from public.daily_countries where iso2='JO'),'The ancient city of Petra is located in this country.',true),
((select id from public.daily_countries where iso2='IL'),'Jerusalem and Tel Aviv are major cities in this eastern Mediterranean country.',true),
((select id from public.daily_countries where iso2='NG'),'Lagos is the largest city in this West African country.',true),
((select id from public.daily_countries where iso2='GH'),'Accra is the capital of this West African country.',true),
((select id from public.daily_countries where iso2='ET'),'Addis Ababa is the capital of this Horn of Africa country.',true),
((select id from public.daily_countries where iso2='TN'),'Carthage and Tunis are located in this North African country.',true),
((select id from public.daily_countries where iso2='DZ'),'Algiers is the capital of Africa''s largest country by area.',true),
((select id from public.daily_countries where iso2='CO'),'Bogotá is the capital of this South American country.',true),
((select id from public.daily_countries where iso2='EC'),'Quito and the Galápagos Islands belong to this country.',true),
((select id from public.daily_countries where iso2='BO'),'La Paz and Salar de Uyuni are in this landlocked South American country.',true),
((select id from public.daily_countries where iso2='UY'),'Montevideo is the capital of this country between Brazil and Argentina.',true),
((select id from public.daily_countries where iso2='CR'),'San José is the capital of this Central American country known for biodiversity.',true)
on conflict do nothing;

insert into public.brainiword_words(word,is_active)
values
('OCEAN',true),
('BRAIN',true),
('PLANT',true),
('LIGHT',true),
('WORLD',true),
('MOUSE',true),
('STONE',true),
('RIVER',true),
('CLOUD',true),
('TRAIN',true),
('EARTH',true),
('HOUSE',true),
('MUSIC',true),
('FRUIT',true),
('GREEN',true),
('WATER',true),
('SMILE',true),
('NIGHT',true),
('SPACE',true),
('BEACH',true),
('CHAIR',true),
('SHEEP',true),
('PLANE',true),
('SOUND',true),
('PAPER',true),
('CLOCK',true),
('GRASS',true),
('BREAD',true),
('TIGER',true),
('SUGAR',true),
('APPLE',true),
('BRICK',true),
('CROWN',true),
('DREAM',true),
('FLAME',true),
('GIANT',true),
('HONEY',true),
('JUICE',true),
('KNIFE',true),
('LEMON',true),
('METAL',true),
('NURSE',true),
('OPERA',true),
('PEARL',true),
('QUEEN',true),
('ROBOT',true),
('SHARK',true),
('TABLE',true),
('UNITY',true),
('VOICE',true),
('WHALE',true),
('YOUTH',true),
('ZEBRA',true),
('ANGEL',true),
('BLAST',true),
('CANDY',true),
('DRIVE',true),
('EAGLE',true),
('FROST',true),
('GHOST',true),
('HEART',true),
('IVORY',true),
('JELLY',true),
('KAYAK',true),
('LASER',true),
('MAGIC',true),
('NOVEL',true),
('OLIVE',true),
('PIZZA',true),
('QUEST',true),
('RADIO',true),
('SOLAR',true),
('TRUCK',true),
('URBAN',true),
('VIDEO',true),
('WHEAT',true),
('ALBUM',true),
('BERRY',true),
('CORAL',true),
('DANCE',true),
('ELBOW',true),
('FAITH',true),
('GLASS',true),
('HOTEL',true),
('IDEAL',true),
('JOKER',true),
('KOALA',true),
('LUNCH',true),
('MANGO',true),
('NOBLE',true),
('PAINT',true),
('QUICK',true),
('ROUND',true),
('SNAKE',true),
('TEACH',true),
('VALUE',true),
('WRIST',true),
('YACHT',true),
('AMBER',true),
('BLADE',true),
('CHESS',true),
('DELTA',true),
('EMBER',true),
('FIELD',true),
('GLOBE',true),
('HORSE',true),
('INDEX',true),
('JUDGE',true),
('KNEEL',true),
('LODGE',true),
('MAJOR',true),
('NORTH',true),
('ORBIT',true),
('PRIDE',true),
('QUIET',true),
('RELAY',true),
('SCALE',true),
('THORN',true),
('UNCLE',true),
('VENOM',true),
('WAGON',true),
('YEAST',true),
('ACORN',true),
('BLOOM',true),
('CIVIC',true),
('DAIRY',true),
('EXTRA',true),
('FORGE',true),
('GRAPE',true),
('HUMAN',true)
on conflict(word) do update
set is_active=true;


-- ============================================================
-- DAILY ASSIGNMENTS
-- ============================================================

create table if not exists public.daily_brainiword(
  daily_challenge_id uuid primary key
    references public.daily_challenges(id) on delete cascade,
  word_id uuid not null references public.brainiword_words(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.daily_flag_dash_questions(
  id uuid primary key default gen_random_uuid(),
  daily_challenge_id uuid not null
    references public.daily_challenges(id) on delete cascade,
  position integer not null,
  country_id uuid not null references public.daily_countries(id) on delete restrict,
  option_country_ids uuid[] not null,
  created_at timestamptz not null default now(),
  unique(daily_challenge_id,position),
  unique(daily_challenge_id,country_id),
  constraint daily_flag_position check (position between 1 and 30),
  constraint daily_flag_four_options check (cardinality(option_country_ids)=4)
);

create table if not exists public.daily_map_hunt_questions(
  id uuid primary key default gen_random_uuid(),
  daily_challenge_id uuid not null
    references public.daily_challenges(id) on delete cascade,
  position integer not null,
  clue_id uuid not null references public.map_hunt_clues(id) on delete restrict,
  option_country_ids uuid[] not null,
  created_at timestamptz not null default now(),
  unique(daily_challenge_id,position),
  unique(daily_challenge_id,clue_id),
  constraint daily_map_position check (position between 1 and 10),
  constraint daily_map_four_options check (cardinality(option_country_ids)=4)
);

create index if not exists daily_flag_challenge_idx
  on public.daily_flag_dash_questions(daily_challenge_id,position);

create index if not exists daily_map_challenge_idx
  on public.daily_map_hunt_questions(daily_challenge_id,position);


-- ============================================================
-- GENERATE ALL DAILY GAME CONTENT FOR ONE DAILY CHALLENGE
-- ============================================================

create or replace function public.ensure_brainilab_daily_games(
  p_daily_challenge_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_date date;
  v_number integer;
  v_word_id uuid;
  v_row record;
  v_position integer;
  v_country_id uuid;
  v_options uuid[];
  v_distractors uuid[];
  v_count integer;
begin
  select challenge_date,daily_number
    into v_date,v_number
  from public.daily_challenges
  where id=p_daily_challenge_id;

  if v_date is null then
    raise exception 'Daily challenge not found';
  end if;

  -- BrainiWord: avoid previous 60 days if possible.
  if not exists(
    select 1 from public.daily_brainiword
    where daily_challenge_id=p_daily_challenge_id
  ) then
    select bw.id
      into v_word_id
    from public.brainiword_words bw
    where bw.is_active=true
      and not exists(
        select 1
        from public.daily_brainiword dbw
        join public.daily_challenges dc
          on dc.id=dbw.daily_challenge_id
        where dbw.word_id=bw.id
          and dc.challenge_date < v_date
          and dc.challenge_date >= v_date - 60
      )
    order by md5(bw.id::text||':'||v_date::text)
    limit 1;

    if v_word_id is null then
      select bw.id
        into v_word_id
      from public.brainiword_words bw
      where bw.is_active=true
      order by (
        select max(dc.challenge_date)
        from public.daily_brainiword old
        join public.daily_challenges dc on dc.id=old.daily_challenge_id
        where old.word_id=bw.id
      ) asc nulls first,
      md5(bw.id::text||':'||v_date::text)
      limit 1;
    end if;

    insert into public.daily_brainiword(daily_challenge_id,word_id)
    values(p_daily_challenge_id,v_word_id);
  end if;

  -- Flag Dash: deterministic 30-country daily set.
  if not exists(
    select 1 from public.daily_flag_dash_questions
    where daily_challenge_id=p_daily_challenge_id
  ) then
    v_position:=0;

    for v_row in
      select c.id
      from public.daily_countries c
      where c.is_active=true
      order by md5(c.id::text||':flag:'||v_date::text)
      limit 30
    loop
      v_position:=v_position+1;
      v_country_id:=v_row.id;

      select array_agg(x.id order by md5(x.id::text||':d:'||v_date::text||':'||v_position::text))
        into v_distractors
      from (
        select c2.id
        from public.daily_countries c2
        where c2.is_active=true
          and c2.id<>v_country_id
        order by md5(c2.id::text||':flagopt:'||v_date::text||':'||v_position::text)
        limit 3
      ) x;

      select array_agg(u order by md5(u::text||':order:'||v_date::text||':'||v_position::text))
        into v_options
      from unnest(array_append(v_distractors,v_country_id)) u;

      insert into public.daily_flag_dash_questions(
        daily_challenge_id,position,country_id,option_country_ids
      )
      values(
        p_daily_challenge_id,v_position,v_country_id,v_options
      );
    end loop;
  end if;

  -- Map Hunt: deterministic 10 clues.
  if not exists(
    select 1 from public.daily_map_hunt_questions
    where daily_challenge_id=p_daily_challenge_id
  ) then
    v_position:=0;

    for v_row in
      select mh.id,mh.country_id
      from public.map_hunt_clues mh
      where mh.is_active=true
      order by md5(mh.id::text||':map:'||v_date::text)
      limit 10
    loop
      v_position:=v_position+1;
      v_country_id:=v_row.country_id;

      select array_agg(x.id order by md5(x.id::text||':md:'||v_date::text||':'||v_position::text))
        into v_distractors
      from (
        select c2.id
        from public.daily_countries c2
        where c2.is_active=true
          and c2.id<>v_country_id
        order by md5(c2.id::text||':mapopt:'||v_date::text||':'||v_position::text)
        limit 3
      ) x;

      select array_agg(u order by md5(u::text||':morder:'||v_date::text||':'||v_position::text))
        into v_options
      from unnest(array_append(v_distractors,v_country_id)) u;

      insert into public.daily_map_hunt_questions(
        daily_challenge_id,position,clue_id,option_country_ids
      )
      values(
        p_daily_challenge_id,v_position,v_row.id,v_options
      );
    end loop;
  end if;

  select count(*) into v_count
  from public.daily_flag_dash_questions
  where daily_challenge_id=p_daily_challenge_id;

  if v_count<>30 then
    raise exception 'Flag Dash Daily must contain 30 questions, got %',v_count;
  end if;

  select count(*) into v_count
  from public.daily_map_hunt_questions
  where daily_challenge_id=p_daily_challenge_id;

  if v_count<>10 then
    raise exception 'Map Hunt Daily must contain 10 questions, got %',v_count;
  end if;
end;
$$;

revoke execute on function public.ensure_brainilab_daily_games(uuid)
  from public,anon,authenticated;


create or replace function public.handle_brainilab_daily_games_generation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.ensure_brainilab_daily_games(new.id);
  return new;
end;
$$;

drop trigger if exists daily_challenges_generate_all_games
  on public.daily_challenges;

create trigger daily_challenges_generate_all_games
after insert on public.daily_challenges
for each row
execute function public.handle_brainilab_daily_games_generation();


-- ============================================================
-- PUBLIC FETCH RPCs
-- ============================================================

create or replace function public.get_brainilab_daily_flagdash()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_daily record;
  v_items jsonb;
begin
  select id,daily_number,challenge_date
    into v_daily
  from public.daily_challenges
  where challenge_date=current_date
    and status='published'
  limit 1;

  if v_daily.id is null then return null; end if;

  select jsonb_agg(
    jsonb_build_object(
      'item_id',q.id,
      'position',q.position,
      'iso2',c.iso2,
      'options',(
        select jsonb_agg(
          jsonb_build_object('id',oc.id,'text',oc.country_name)
          order by array_position(q.option_country_ids,oc.id)
        )
        from public.daily_countries oc
        where oc.id=any(q.option_country_ids)
      )
    )
    order by q.position
  )
  into v_items
  from public.daily_flag_dash_questions q
  join public.daily_countries c on c.id=q.country_id
  where q.daily_challenge_id=v_daily.id;

  return jsonb_build_object(
    'daily_challenge_id',v_daily.id,
    'daily_number',v_daily.daily_number,
    'challenge_date',v_daily.challenge_date,
    'total',30,
    'items',coalesce(v_items,'[]'::jsonb)
  );
end;
$$;

create or replace function public.check_brainilab_flagdash_answer(
  p_item_id uuid,
  p_selected_country_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_correct_id uuid;
  v_correct_name text;
  v_valid boolean;
begin
  select q.country_id,c.country_name
    into v_correct_id,v_correct_name
  from public.daily_flag_dash_questions q
  join public.daily_challenges dc on dc.id=q.daily_challenge_id
  join public.daily_countries c on c.id=q.country_id
  where q.id=p_item_id
    and dc.challenge_date=current_date
    and dc.status='published';

  if v_correct_id is null then
    raise exception 'Flag Dash item not available';
  end if;

  select exists(
    select 1
    from public.daily_flag_dash_questions q
    where q.id=p_item_id
      and p_selected_country_id=any(q.option_country_ids)
  ) into v_valid;

  if not v_valid then
    raise exception 'Selected country is not an option for this item';
  end if;

  return jsonb_build_object(
    'is_correct',p_selected_country_id=v_correct_id,
    'correct_country_id',v_correct_id,
    'correct_answer',v_correct_name
  );
end;
$$;


create or replace function public.get_brainilab_daily_maphunt()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_daily record;
  v_items jsonb;
begin
  select id,daily_number,challenge_date
    into v_daily
  from public.daily_challenges
  where challenge_date=current_date
    and status='published'
  limit 1;

  if v_daily.id is null then return null; end if;

  select jsonb_agg(
    jsonb_build_object(
      'item_id',q.id,
      'position',q.position,
      'clue',mh.clue,
      'options',(
        select jsonb_agg(
          jsonb_build_object('id',oc.id,'text',oc.country_name)
          order by array_position(q.option_country_ids,oc.id)
        )
        from public.daily_countries oc
        where oc.id=any(q.option_country_ids)
      )
    )
    order by q.position
  )
  into v_items
  from public.daily_map_hunt_questions q
  join public.map_hunt_clues mh on mh.id=q.clue_id
  where q.daily_challenge_id=v_daily.id;

  return jsonb_build_object(
    'daily_challenge_id',v_daily.id,
    'daily_number',v_daily.daily_number,
    'challenge_date',v_daily.challenge_date,
    'total',10,
    'items',coalesce(v_items,'[]'::jsonb)
  );
end;
$$;

create or replace function public.check_brainilab_maphunt_answer(
  p_item_id uuid,
  p_selected_country_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_correct_id uuid;
  v_correct_name text;
  v_valid boolean;
begin
  select mh.country_id,c.country_name
    into v_correct_id,v_correct_name
  from public.daily_map_hunt_questions q
  join public.daily_challenges dc on dc.id=q.daily_challenge_id
  join public.map_hunt_clues mh on mh.id=q.clue_id
  join public.daily_countries c on c.id=mh.country_id
  where q.id=p_item_id
    and dc.challenge_date=current_date
    and dc.status='published';

  if v_correct_id is null then
    raise exception 'Map Hunt item not available';
  end if;

  select exists(
    select 1
    from public.daily_map_hunt_questions q
    where q.id=p_item_id
      and p_selected_country_id=any(q.option_country_ids)
  ) into v_valid;

  if not v_valid then
    raise exception 'Selected country is not an option for this item';
  end if;

  return jsonb_build_object(
    'is_correct',p_selected_country_id=v_correct_id,
    'correct_country_id',v_correct_id,
    'correct_answer',v_correct_name
  );
end;
$$;


create or replace function public.get_brainilab_daily_brainiword()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_daily record;
begin
  select dc.id,dc.daily_number,dc.challenge_date
    into v_daily
  from public.daily_challenges dc
  join public.daily_brainiword dbw
    on dbw.daily_challenge_id=dc.id
  where dc.challenge_date=current_date
    and dc.status='published'
  limit 1;

  if v_daily.id is null then return null; end if;

  return jsonb_build_object(
    'daily_challenge_id',v_daily.id,
    'daily_number',v_daily.daily_number,
    'challenge_date',v_daily.challenge_date,
    'letters',5,
    'attempts',5
  );
end;
$$;


create or replace function public.check_brainilab_brainiword_guess(
  p_daily_challenge_id uuid,
  p_guess text,
  p_attempt integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_answer text;
  v_guess text:=upper(trim(p_guess));
  v_answer_chars text[];
  v_guess_chars text[];
  v_states text[]:=array['absent','absent','absent','absent','absent'];
  v_used boolean[]:=array[false,false,false,false,false];
  i integer;
  j integer;
  v_won boolean;
  v_finished boolean;
begin
  if v_guess !~ '^[A-Z]{5}$' then
    raise exception 'Guess must contain exactly five letters';
  end if;

  if p_attempt not between 1 and 5 then
    raise exception 'Invalid attempt';
  end if;

  select bw.word
    into v_answer
  from public.daily_brainiword dbw
  join public.daily_challenges dc
    on dc.id=dbw.daily_challenge_id
  join public.brainiword_words bw
    on bw.id=dbw.word_id
  where dbw.daily_challenge_id=p_daily_challenge_id
    and dc.challenge_date=current_date
    and dc.status='published';

  if v_answer is null then
    raise exception 'BrainiWord Daily not available';
  end if;

  v_answer_chars:=array[
    substr(v_answer,1,1),substr(v_answer,2,1),substr(v_answer,3,1),
    substr(v_answer,4,1),substr(v_answer,5,1)
  ];
  v_guess_chars:=array[
    substr(v_guess,1,1),substr(v_guess,2,1),substr(v_guess,3,1),
    substr(v_guess,4,1),substr(v_guess,5,1)
  ];

  for i in 1..5 loop
    if v_guess_chars[i]=v_answer_chars[i] then
      v_states[i]:='correct';
      v_used[i]:=true;
    end if;
  end loop;

  for i in 1..5 loop
    if v_states[i]='correct' then continue; end if;

    for j in 1..5 loop
      if not v_used[j] and v_guess_chars[i]=v_answer_chars[j] then
        v_states[i]:='present';
        v_used[j]:=true;
        exit;
      end if;
    end loop;
  end loop;

  v_won:=v_guess=v_answer;
  v_finished:=v_won or p_attempt=5;

  return jsonb_build_object(
    'states',to_jsonb(v_states),
    'won',v_won,
    'finished',v_finished,
    'answer',case when v_finished then v_answer else null end
  );
end;
$$;


-- ============================================================
-- AUTHENTICATED FINAL RESULT VERIFICATION
-- ============================================================

create or replace function public.verify_brainilab_flagdash_result(
  p_client_result_id text,
  p_daily_challenge_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_result_id uuid;
  v_session_id uuid;
  v_daily_number integer;
  v_count integer;
  v_correct integer:=0;
  v_combo integer:=0;
  v_best_combo integer:=0;
  v_row record;
  v_answer jsonb;
  v_selected uuid;
  v_score integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_answers,'[]'::jsonb))<>'array' then
    raise exception 'Answers must be an array';
  end if;

  select gs.id,gr.id
    into v_session_id,v_result_id
  from public.game_sessions gs
  join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_user
    and gs.client_result_id=p_client_result_id
    and gs.game_id='flagdash';

  if v_result_id is null then raise exception 'Flag Dash result not found'; end if;

  select daily_number into v_daily_number
  from public.daily_challenges
  where id=p_daily_challenge_id;

  select count(*) into v_count
  from public.daily_flag_dash_questions
  where daily_challenge_id=p_daily_challenge_id;

  if v_count<>30 or jsonb_array_length(p_answers)<>30 then
    raise exception 'Flag Dash requires exactly 30 answers';
  end if;

  for v_row in
    select id,country_id,position
    from public.daily_flag_dash_questions
    where daily_challenge_id=p_daily_challenge_id
    order by position
  loop
    select value into v_answer
    from jsonb_array_elements(p_answers)
    where value->>'item_id'=v_row.id::text
    limit 1;

    if v_answer is null then
      raise exception 'Missing Flag Dash answer at position %',v_row.position;
    end if;

    v_selected:=(v_answer->>'selected_country_id')::uuid;

    if v_selected=v_row.country_id then
      v_correct:=v_correct+1;
      v_combo:=v_combo+1;
      v_best_combo:=greatest(v_best_combo,v_combo);
    else
      v_combo:=0;
    end if;
  end loop;

  v_score:=v_correct*70+v_best_combo*15;

  update public.game_sessions
  set daily_challenge_id=p_daily_challenge_id,
      daily_number=v_daily_number
  where id=v_session_id;

  update public.game_results
  set score=v_score,
      correct_answers=v_correct,
      total_questions=30,
      accuracy=round(v_correct::numeric/30*100,2),
      server_verified=false,
      answers_verified=true,
      verified_correct_answers=v_correct,
      verified_total_questions=30,
      answers_verified_at=now(),
      result_payload=jsonb_set(
        jsonb_set(result_payload,'{bestCombo}',to_jsonb(v_best_combo),true),
        '{verifiedDailyGame}','true'::jsonb,true
      )
  where id=v_result_id;

  return jsonb_build_object(
    'verified',true,
    'correct',v_correct,
    'total',30,
    'accuracy',round(v_correct::numeric/30*100,2),
    'best_combo',v_best_combo,
    'score',v_score,
    'daily_number',v_daily_number
  );
end;
$$;


create or replace function public.verify_brainilab_maphunt_result(
  p_client_result_id text,
  p_daily_challenge_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_result_id uuid;
  v_session_id uuid;
  v_daily_number integer;
  v_count integer;
  v_correct integer:=0;
  v_row record;
  v_answer jsonb;
  v_selected uuid;
  v_score integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select gs.id,gr.id
    into v_session_id,v_result_id
  from public.game_sessions gs
  join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_user
    and gs.client_result_id=p_client_result_id
    and gs.game_id='maphunt';

  if v_result_id is null then raise exception 'Map Hunt result not found'; end if;

  select daily_number into v_daily_number
  from public.daily_challenges
  where id=p_daily_challenge_id;

  select count(*) into v_count
  from public.daily_map_hunt_questions
  where daily_challenge_id=p_daily_challenge_id;

  if v_count<>10 or jsonb_array_length(p_answers)<>10 then
    raise exception 'Map Hunt requires exactly 10 answers';
  end if;

  for v_row in
    select q.id,mh.country_id,q.position
    from public.daily_map_hunt_questions q
    join public.map_hunt_clues mh on mh.id=q.clue_id
    where q.daily_challenge_id=p_daily_challenge_id
    order by q.position
  loop
    select value into v_answer
    from jsonb_array_elements(p_answers)
    where value->>'item_id'=v_row.id::text
    limit 1;

    if v_answer is null then
      raise exception 'Missing Map Hunt answer at position %',v_row.position;
    end if;

    v_selected:=(v_answer->>'selected_country_id')::uuid;
    if v_selected=v_row.country_id then
      v_correct:=v_correct+1;
    end if;
  end loop;

  v_score:=v_correct*600;

  update public.game_sessions
  set daily_challenge_id=p_daily_challenge_id,
      daily_number=v_daily_number
  where id=v_session_id;

  update public.game_results
  set score=v_score,
      correct_answers=v_correct,
      total_questions=10,
      accuracy=round(v_correct::numeric/10*100,2),
      server_verified=false,
      answers_verified=true,
      verified_correct_answers=v_correct,
      verified_total_questions=10,
      answers_verified_at=now(),
      result_payload=jsonb_set(
        result_payload,'{verifiedDailyGame}','true'::jsonb,true
      )
  where id=v_result_id;

  return jsonb_build_object(
    'verified',true,
    'correct',v_correct,
    'total',10,
    'accuracy',round(v_correct::numeric/10*100,2),
    'score',v_score,
    'daily_number',v_daily_number
  );
end;
$$;


create or replace function public.verify_brainilab_brainiword_result(
  p_client_result_id text,
  p_daily_challenge_id uuid,
  p_guesses jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_result_id uuid;
  v_session_id uuid;
  v_daily_number integer;
  v_answer text;
  v_guess text;
  v_index integer:=0;
  v_win_attempt integer:=null;
  v_won boolean:=false;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(coalesce(p_guesses,'[]'::jsonb))<>'array' then
    raise exception 'Guesses must be an array';
  end if;

  select gs.id,gr.id
    into v_session_id,v_result_id
  from public.game_sessions gs
  join public.game_results gr on gr.session_id=gs.id
  where gs.user_id=v_user
    and gs.client_result_id=p_client_result_id
    and gs.game_id='brainiword';

  if v_result_id is null then raise exception 'BrainiWord result not found'; end if;

  select dc.daily_number,bw.word
    into v_daily_number,v_answer
  from public.daily_brainiword dbw
  join public.daily_challenges dc on dc.id=dbw.daily_challenge_id
  join public.brainiword_words bw on bw.id=dbw.word_id
  where dbw.daily_challenge_id=p_daily_challenge_id;

  if v_answer is null then raise exception 'BrainiWord Daily not found'; end if;
  if jsonb_array_length(p_guesses)>5 then raise exception 'Too many guesses'; end if;

  for v_guess in
    select upper(value #>> '{}')
    from jsonb_array_elements(p_guesses)
  loop
    v_index:=v_index+1;
    if v_guess=v_answer and v_win_attempt is null then
      v_win_attempt:=v_index;
      v_won:=true;
    end if;
  end loop;

  update public.game_sessions
  set daily_challenge_id=p_daily_challenge_id,
      daily_number=v_daily_number
  where id=v_session_id;

  update public.game_results
  set correct_answers=case when v_won then 1 else 0 end,
      total_questions=1,
      accuracy=case when v_won then 100 else 0 end,
      server_verified=false,
      answers_verified=true,
      verified_correct_answers=case when v_won then 1 else 0 end,
      verified_total_questions=1,
      answers_verified_at=now(),
      result_payload=jsonb_set(
        jsonb_set(
          jsonb_set(result_payload,'{won}',to_jsonb(v_won),true),
          '{attempts}',to_jsonb(coalesce(v_win_attempt,5)),true
        ),
        '{verifiedDailyGame}','true'::jsonb,true
      )
  where id=v_result_id;

  return jsonb_build_object(
    'verified',true,
    'won',v_won,
    'attempts',coalesce(v_win_attempt,5),
    'daily_number',v_daily_number
  );
end;
$$;


-- ============================================================
-- RLS + RPC PERMISSIONS
-- ============================================================

alter table public.daily_countries enable row level security;
alter table public.map_hunt_clues enable row level security;
alter table public.brainiword_words enable row level security;
alter table public.daily_brainiword enable row level security;
alter table public.daily_flag_dash_questions enable row level security;
alter table public.daily_map_hunt_questions enable row level security;

revoke all on table public.daily_countries from anon,authenticated;
revoke all on table public.map_hunt_clues from anon,authenticated;
revoke all on table public.brainiword_words from anon,authenticated;
revoke all on table public.daily_brainiword from anon,authenticated;
revoke all on table public.daily_flag_dash_questions from anon,authenticated;
revoke all on table public.daily_map_hunt_questions from anon,authenticated;

revoke execute on function public.get_brainilab_daily_flagdash() from public;
revoke execute on function public.check_brainilab_flagdash_answer(uuid,uuid) from public;
revoke execute on function public.get_brainilab_daily_maphunt() from public;
revoke execute on function public.check_brainilab_maphunt_answer(uuid,uuid) from public;
revoke execute on function public.get_brainilab_daily_brainiword() from public;
revoke execute on function public.check_brainilab_brainiword_guess(uuid,text,integer) from public;

grant execute on function public.get_brainilab_daily_flagdash() to anon,authenticated;
grant execute on function public.check_brainilab_flagdash_answer(uuid,uuid) to anon,authenticated;
grant execute on function public.get_brainilab_daily_maphunt() to anon,authenticated;
grant execute on function public.check_brainilab_maphunt_answer(uuid,uuid) to anon,authenticated;
grant execute on function public.get_brainilab_daily_brainiword() to anon,authenticated;
grant execute on function public.check_brainilab_brainiword_guess(uuid,text,integer) to anon,authenticated;

revoke execute on function public.verify_brainilab_flagdash_result(text,uuid,jsonb) from public,anon;
revoke execute on function public.verify_brainilab_maphunt_result(text,uuid,jsonb) from public,anon;
revoke execute on function public.verify_brainilab_brainiword_result(text,uuid,jsonb) from public,anon;

grant execute on function public.verify_brainilab_flagdash_result(text,uuid,jsonb) to authenticated;
grant execute on function public.verify_brainilab_maphunt_result(text,uuid,jsonb) to authenticated;
grant execute on function public.verify_brainilab_brainiword_result(text,uuid,jsonb) to authenticated;


-- ============================================================
-- BACKFILL ALL DAILY CHALLENGES ALREADY CREATED BY STEP 5
-- ============================================================

do $$
declare
  v_daily record;
begin
  for v_daily in
    select id
    from public.daily_challenges
    order by challenge_date
  loop
    perform public.ensure_brainilab_daily_games(v_daily.id);
  end loop;
end;
$$;

commit;


-- ============================================================
-- VERIFICATION QUERIES — RUN SEPARATELY
-- ============================================================
--
-- Every Daily should have 1 word, 30 flags and 10 Map Hunt clues:
--
-- select
--   dc.challenge_date,
--   dc.daily_number,
--   (select count(*) from public.daily_brainiword w where w.daily_challenge_id=dc.id) as words,
--   (select count(*) from public.daily_flag_dash_questions f where f.daily_challenge_id=dc.id) as flags,
--   (select count(*) from public.daily_map_hunt_questions m where m.daily_challenge_id=dc.id) as map_clues
-- from public.daily_challenges dc
-- order by dc.challenge_date;
--
-- Expected on every row:
-- words=1, flags=30, map_clues=10
